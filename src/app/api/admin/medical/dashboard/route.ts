import { NextResponse } from "next/server";
import { logAccess } from "@/lib/accessLog";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { medicalLabel, documentValidity } from "@/lib/medical";

export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;

// Krankenfahrten-Dashboard fürs Taxiunternehmen: KPIs + Aufschlüsselung nach
// Krankenkasse / Einrichtung / Fahrtart für den laufenden Monat. Nutzt nur
// vorhandene Daten (Buchungen mit medicalType, MedicalDocument, RecurringRide),
// firmenscoped über die Session.
export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const companyId = session.companyId;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 3600 * 1000);

  const monthRides = await prisma.booking.findMany({
    where: {
      companyId,
      medicalType: { not: null },
      // EIN eindeutiger Zeitpunkt je Fahrt, nicht "irgendeines von dreien".
      // Vorher zaehlte eine am 20. September angelegte Fahrt fuer den 10.
      // Oktober bereits im September mit - allein wegen des Anlagedatums.
      // Massgeblich ist, wann gefahren wurde (oder werden soll).
      OR: [
        { status: "ABGESCHLOSSEN", completedAt: { gte: monthStart, lt: monthEnd } },
        { status: { not: "ABGESCHLOSSEN" }, scheduledAt: { gte: monthStart, lt: monthEnd } },
        { status: { not: "ABGESCHLOSSEN" }, scheduledAt: null, createdAt: { gte: monthStart, lt: monthEnd } },
      ],
    },
    select: {
      id: true, status: true, fare: true, payerType: true, insuranceName: true,
      institutionId: true, medicalType: true, recurringId: true,
      createdAt: true, scheduledAt: true, completedAt: true,
    },
  });

  const refDate = (b: (typeof monthRides)[number]) => b.scheduledAt ?? b.completedAt ?? b.createdAt;
  const inToday = (d: Date | null) => !!d && d >= todayStart && d < todayEnd;

  const completed = monthRides.filter((b) => b.status === "ABGESCHLOSSEN");

  // Dokument-Ablauf-Ampel: Nachweise mit Gültigkeitsdatum zu Buchungen dieser
  // Firma; alles, was bald abläuft oder abgelaufen ist, kommt in die Warnungen.
  //
  // Ein Nachweis hängt nicht immer an einer einzelnen Fahrt: bei einer
  // Serienfahrt (Dialyse, Reha) wird die Verordnung an die SERIE gehängt.
  // Solche Dokumente fielen hier bisher heraus – die Verordnung war hochgeladen,
  // tauchte in der Prüfliste der Zentrale aber nie auf und lief unbemerkt ab.
  const validityDocs = await prisma.medicalDocument.findMany({
    where: {
      validUntil: { not: null },
      OR: [
        { booking: { companyId } },
        { recurring: { bookings: { some: { companyId } } } },
      ],
    },
    select: { id: true, kind: true, fileName: true, validUntil: true, bookingId: true, recurringId: true },
  });
  // Erst alle bewerten (fuer die Kennzahlen), dann fuer die Anzeige kuerzen.
  const alleBewertet = validityDocs.map((d) => ({ ...d, ...documentValidity(d.validUntil) }));
  const warnings = validityDocs
    .map((d) => ({ ...d, ...documentValidity(d.validUntil) }))
    .filter((d) => d.status === "EXPIRING" || d.status === "EXPIRED")
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .slice(0, 25);

  const kpis = {
    total: monthRides.length,
    today: monthRides.filter((b) => inToday(refDate(b))).length,
    inProgress: monthRides.filter((b) => ["OFFEN", "ZUGEWIESEN", "AKTIV"].includes(b.status)).length,
    completedThisMonth: completed.length,
    revenueThisMonth: r2(completed.reduce((s, b) => s + (b.fare ?? 0), 0)),
    // "Aktiv" hiess bisher nur "irgendeine Fahrt dieses Monats verweist darauf".
    // Eine vor zwei Wochen beendete Serie zaehlte deshalb weiter mit.
    activeSeries: await prisma.recurringRide.count({
      where: {
        active: true,
        id: { in: [...new Set(monthRides.filter((b) => b.recurringId).map((b) => b.recurringId as string))] },
      },
    }),
    // Auch Nachweise, die an einer SERIE haengen (Dialyse, Reha) - die haben
    // keine einzelne Fahrt und fehlten deshalb komplett in der Zahl.
    pendingDocs: await prisma.medicalDocument.count({
      where: {
        reviewStatus: "PENDING",
        OR: [{ booking: { companyId } }, { recurring: { bookings: { some: { companyId } } } }],
      },
    }),
    // Aus ALLEN Dokumenten, nicht aus der auf 25 gekuerzten Anzeigeliste:
    // vorher meldete das Dashboard hoechstens 25 Probleme, auch wenn es 70
    // waren - bei Nachweisen fuer Krankenfahrten ist das gefaehrlich.
    expiringDocs: alleBewertet.filter((d) => d.status === "EXPIRING").length,
    expiredDocs: alleBewertet.filter((d) => d.status === "EXPIRED").length,
  };

  // Aufschlüsselung nach Krankenkasse (Privatzahler separat).
  const payerMap = new Map<string, { name: string; count: number; revenue: number }>();
  for (const b of monthRides) {
    const key = b.payerType === "INSURANCE" ? (b.insuranceName || "Krankenkasse (ohne Name)") : "Privatzahler";
    const cur = payerMap.get(key) ?? { name: key, count: 0, revenue: 0 };
    cur.count++;
    if (b.status === "ABGESCHLOSSEN") cur.revenue += b.fare ?? 0;
    payerMap.set(key, cur);
  }
  const byPayer = [...payerMap.values()].map((x) => ({ ...x, revenue: r2(x.revenue) })).sort((a, b) => b.count - a.count);

  // Aufschlüsselung nach Einrichtung.
  const instIds = [...new Set(monthRides.map((b) => b.institutionId).filter(Boolean))] as string[];
  const insts = instIds.length
    ? await prisma.institution.findMany({ where: { id: { in: instIds } }, select: { id: true, name: true } })
    : [];
  const instName = Object.fromEntries(insts.map((i) => [i.id, i.name]));
  const instMap = new Map<string, { name: string; count: number; revenue: number }>();
  for (const b of monthRides) {
    if (!b.institutionId) continue;
    const cur = instMap.get(b.institutionId) ?? { name: instName[b.institutionId] ?? "Einrichtung", count: 0, revenue: 0 };
    cur.count++;
    if (b.status === "ABGESCHLOSSEN") cur.revenue += b.fare ?? 0;
    instMap.set(b.institutionId, cur);
  }
  const byInstitution = [...instMap.values()].map((x) => ({ ...x, revenue: r2(x.revenue) })).sort((a, b) => b.count - a.count);

  // Aufschlüsselung nach Fahrtart (Dialyse/Reha/...).
  const typeMap = new Map<string, { label: string; count: number }>();
  for (const b of monthRides) {
    const key = b.medicalType ?? "SONSTIGE";
    const cur = typeMap.get(key) ?? { label: medicalLabel(key) ?? key, count: 0 };
    cur.count++;
    typeMap.set(key, cur);
  }
  const byType = [...typeMap.values()].sort((a, b) => b.count - a.count);

  const monthLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(monthStart);

  // Diese Auswertung schluesselt Krankenfahrten nach Krankenkasse, Einrichtung
  // und Fahrtart auf - ein Zugriff auf Gesundheitsdaten im Ueberblick. Die
  // uebrigen medizinischen Wege protokollieren laengst; hier fehlte es.
  await logAccess({
    actorType: "ADMIN",
    companyId,
    actorId: companyId,
    action: "VIEW",
    entity: "MEDICAL_DOCUMENT",
    detail: `Krankenfahrten-Auswertung ${monthLabel} (${monthRides.length} Fahrten)`,
  });

  return NextResponse.json({ monthLabel, kpis, byPayer, byInstitution, byType, warnings });
}
