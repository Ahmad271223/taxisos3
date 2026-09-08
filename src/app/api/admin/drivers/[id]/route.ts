import { NextResponse } from "next/server";
import { aboGesperrt } from "@/lib/firmaAktiv";
import { logAccess } from "@/lib/accessLog";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { driverAdmin, bookingDTO } from "@/server/serialize";
import { normalizeClass } from "@/lib/vehicleClasses";
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  vehicleModel: z.string().optional().nullable(),
  vehiclePlate: z.string().optional().nullable(),
  vehicleColor: z.string().optional().nullable(),
  vehicleSeats: z.number().int().min(1).max(9).optional(),
  vehicleClass: z.string().optional().nullable(),
  medicalAllowed: z.boolean().optional(),
  hasRamp: z.boolean().optional(),
  hasStretcher: z.boolean().optional(),
  pScheinUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte JJJJ-MM-TT").optional().nullable().or(z.literal("")),
  wheelchairTrained: z.boolean().optional(),
  qualifications: z.string().max(300).optional().nullable(),
  licenseUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte JJJJ-MM-TT").optional().nullable().or(z.literal("")),
  concessionUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte JJJJ-MM-TT").optional().nullable().or(z.literal("")),
  insuranceUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte JJJJ-MM-TT").optional().nullable().or(z.literal("")),
  tuevUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte JJJJ-MM-TT").optional().nullable().or(z.literal("")),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  // Abo-Sperre: gekuendigt oder ueberfaellig -> keine betriebsrelevanten
  // Aenderungen mehr. Lesen bleibt erlaubt (Rechnungen, Belege, Abo-Seite).
  const abo = await aboGesperrt(session.companyId);
  if (abo) return abo;

  // Mandantencheck: Fahrer muss zur eigenen Firma gehoeren.
  const existing = await prisma.driver.findUnique({ where: { id: params.id } });
  if (!existing || existing.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  }
  // vehicleClass darf nicht null an Prisma (Spalte ist non-null); null = nicht ändern.
  const { vehicleClass, ...rest } = parsed.data;
  const data: any = { ...rest };
  if (vehicleClass != null) data.vehicleClass = normalizeClass(vehicleClass);
  const driver = await prisma.driver.update({ where: { id: params.id }, data });

  // Wer hat einem Fahrer erlaubt, Krankenfahrten zu uebernehmen? Wer hat den
  // P-Schein-Ablauf verschoben? Das war bisher nirgends festgehalten.
  const wichtig = ["active", "medicalAllowed", "hasRamp", "hasStretcher", "wheelchairTrained",
    "pScheinUntil", "licenseUntil", "concessionUntil", "insuranceUntil", "tuevUntil"] as const;
  const geaendert = wichtig.filter((k) => (parsed.data as any)[k] !== undefined);
  if (geaendert.length) {
    await logAccess({
      actorType: "ADMIN",
      companyId: session.companyId,
      actorId: session.companyId,
      action: "UPDATE",
      entity: "DRIVER",
      entityId: driver.id,
      detail: `Fahrer ${driver.name}: ${geaendert.map((k) => `${k}=${String((parsed.data as any)[k])}`).join(", ")}`,
    });
  }

  // Eine Deaktivierung muss SOFORT wirken: offene Verbindungen des Fahrers
  // werden getrennt und er verschwindet aus der Disposition. Sonst faehrt er
  // mit seiner bereits offenen Sitzung einfach weiter.
  if (parsed.data.active === false) {
    const rt = getRuntime();
    try {
      await rt?.dispatcher.setStatus(params.id, "OFFLINE");
    } catch (e: any) {
      console.error("Fahrer offline setzen fehlgeschlagen:", e?.message ?? e);
    }
    try {
      rt?.io.in(`driver:${params.id}`).disconnectSockets(true);
    } catch (e: any) {
      console.error("Fahrer-Verbindung trennen fehlgeschlagen:", e?.message ?? e);
    }
  }

  return NextResponse.json({ driver: driverAdmin(driver) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  // Abo-Sperre: gekuendigt oder ueberfaellig -> keine betriebsrelevanten
  // Aenderungen mehr. Lesen bleibt erlaubt (Rechnungen, Belege, Abo-Seite).
  const abo = await aboGesperrt(session.companyId);
  if (abo) return abo;
  const existing = await prisma.driver.findUnique({ where: { id: params.id } });
  if (!existing || existing.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  // ZUERST stilllegen, dann pruefen. Vorher wurde gezaehlt, dann geloescht -
  // dazwischen konnte die Vermittlung dem Fahrer noch eine Fahrt zuweisen, die
  // ihren Fahrer sofort wieder verlor. Ein deaktivierter Fahrer wird nicht mehr
  // disponiert (siehe Vermittlung), das Zeitfenster ist damit zu.
  // REIHENFOLGE: erst gegen NEUE Zuweisungen sperren, dann pruefen, und erst
  // ganz zum Schluss die Verbindung trennen.
  //
  // Das Deaktivieren allein stoert eine laufende Fahrt nicht - der Fahrer
  // behaelt seine Verbindung und kann sie zu Ende bringen. Vorher wurde er
  // sofort getrennt und offline gesetzt, und ERST DANACH fiel auf, dass er
  // gerade jemanden faehrt: die Fahrt verlor GPS, Chat und Statusmeldungen,
  // obwohl das Loeschen anschliessend mit 409 abgelehnt wurde.
  await prisma.driver.update({ where: { id: existing.id }, data: { active: false } });

  const activeCount = await prisma.booking.count({
    where: { driverId: existing.id, status: { in: ["ZUGEWIESEN", "AKTIV"] } },
  });
  if (activeCount > 0) {
    // Sperre zuruecknehmen - der Fahrer bleibt unangetastet im Dienst.
    await prisma.driver.update({ where: { id: existing.id }, data: { active: true } });
    return NextResponse.json(
      { error: "Fahrer hat noch laufende Aufträge. Bitte zuerst abschließen oder stornieren." },
      { status: 409 },
    );
  }

  // Ab hier steht fest, dass er wirklich geloescht wird.
  const rt0 = getRuntime();
  try {
    await rt0?.dispatcher.setStatus(existing.id, "OFFLINE");
  } catch {
    /* Der Fahrer wird ohnehin geloescht. */
  }
  try {
    rt0?.io.in(`driver:${existing.id}`).disconnectSockets(true);
  } catch {
    /* siehe oben */
  }

  // HISTORIE SICHERN, BEVOR die Verknüpfung fällt.
  //
  // Der Kommentar sagte „Historie behalten", tatsächlich wurde bei ALLEN
  // Fahrten `driverId` geleert – auch bei längst abgeschlossenen. Danach war
  // nicht mehr feststellbar, wer eine Fahrt vor zwei Jahren durchgeführt hat:
  // für Beschwerden, Versicherungsfälle und Krankenfahrten ein echter Verlust.
  //
  // Die Belege kennen dafür bereits `driverNameSnap`/`driverPlateSnap`. Gesetzt
  // werden die aber erst beim Abschluss einer Fahrt – ältere und abgebrochene
  // Fahrten haben sie nicht. Deshalb werden sie hier nachgetragen, solange der
  // Fahrer noch existiert. Die Fahrt weiß danach dauerhaft, wer sie gefahren
  // hat, ohne dass der Personendatensatz erhalten bleiben muss.
  await prisma.booking.updateMany({
    where: { driverId: existing.id, driverNameSnap: null },
    data: { driverNameSnap: existing.name, driverPlateSnap: existing.vehiclePlate ?? null },
  });

  await prisma.booking.updateMany({
    where: { driverId: existing.id },
    data: { driverId: null },
  });
  await prisma.driver.delete({ where: { id: params.id } });

  await logAccess({
    actorType: "ADMIN",
    companyId: session.companyId,
    actorId: session.companyId,
    action: "CANCEL",
    entity: "DRIVER",
    entityId: existing.id,
    detail: `Fahrer ${existing.name} gelöscht (Fahrtenhistorie über Namens-Schnappschuss erhalten)`,
  });

  return NextResponse.json({ ok: true });
}

// Detail-Endpunkt fuer "Fahrer auf Karte anklicken".
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const driver = await prisma.driver.findUnique({ where: { id: params.id } });
  if (!driver || driver.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const [activeBooking, agg, recent] = await Promise.all([
    prisma.booking.findFirst({
      where: { driverId: driver.id, status: { in: ["ZUGEWIESEN", "AKTIV"] } },
    }),
    prisma.booking.aggregate({
      where: { driverId: driver.id, rating: { not: null } },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.booking.findMany({
      where: { driverId: driver.id, status: "ABGESCHLOSSEN" },
      orderBy: { completedAt: "desc" },
      take: 5,
      select: { id: true, completedAt: true, fare: true, rating: true, pickupAddress: true, destAddress: true },
    }),
  ]);
  return NextResponse.json({
    driver: driverAdmin(driver),
    // Nicht der rohe Datensatz: das DTO entscheidet, was nach aussen darf.
    activeBooking: activeBooking ? bookingDTO(activeBooking) : null,
    ratings: { avg: agg._avg.rating ?? null, count: agg._count.rating ?? 0 },
    recent,
  });
}
