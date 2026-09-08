import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { aboGesperrt } from "@/lib/firmaAktiv";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { vehicleClass as vehicleClassInfo } from "@/lib/vehicleClasses";
import { getDispatcher } from "@/server/runtime";
import { logAccess } from "@/lib/accessLog";

export const dynamic = "force-dynamic";

/**
 * Grobe Lage aus einer Anschrift: Postleitzahl und Ort, ohne Strasse und
 * Hausnummer. "Musterstrasse 12, 30169 Hannover" wird zu "30169 Hannover".
 *
 * Fuer die Entscheidung "kann und will ich diese Fahrt fahren?" reicht das
 * vollstaendig aus. Die genaue Anschrift bekommt erst, wer die Fahrt
 * tatsaechlich uebernimmt.
 */
function grobeLage(adresse: string | null | undefined): string {
  const a = (adresse ?? "").trim();
  if (!a) return "Raum Hannover";
  const plzOrt = a.match(/\b\d{5}\s+[^,]+/);
  if (plzOrt) return plzOrt[0].trim();
  const teile = a.split(",").map((s) => s.trim()).filter(Boolean);
  // Ohne Postleitzahl: den letzten Bestandteil nehmen, aber nie den ersten
  // (der ist die Strasse).
  if (teile.length > 1) return teile[teile.length - 1];
  return "Raum Hannover";
}

// Zuweisungs-Pool: offene Krankenfahrten/Vorbestellungen (dispatchMode ADMIN),
// die noch keiner Zentrale zugewiesen sind. Sichtbar für ALLE Taxi-Zentralen –
// die erste, die einen Fahrer zuweist, bekommt die Fahrt.
//
// DATENSCHUTZ (07.09.2026): Diese Liste geht an FREMDE Unternehmen, die die
// Fahrt noch gar nicht haben. Frueher standen darin Patientenname, die Art der
// Krankenfahrt (Dialyse, Onkologie ...), der Name der Einrichtung und beide
// vollstaendigen Anschriften. Damit konnte jede angemeldete Zentrale
// Gesundheitsdaten namentlich benannter Menschen mitlesen, ohne je etwas mit
// der Fahrt zu tun zu haben - Art. 9 DSGVO, besondere Kategorie.
//
// Jetzt enthaelt der Pool nur noch, was fuer die Entscheidung noetig ist:
// grobe Lage, Zeit, Entfernung und die Anforderungen ans Fahrzeug. Wer
// zuweist, sieht ueber die normale Auftragsansicht sofort alles Weitere.
export async function GET(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  // BLAETTERN statt abschneiden. Vorher endete die Liste hart bei 100: bei mehr
  // offenen Krankenfahrten verschwanden die uebrigen lautlos aus der Ansicht -
  // niemand haette gemerkt, dass Dialyse- oder Reha-Fahrten unbearbeitet
  // liegen. Jetzt sagt die Antwort, ob es weitergeht.
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const cursor = url.searchParams.get("cursor") || null;

  const gefunden = await prisma.booking.findMany({
    where: { dispatchMode: "ADMIN", status: "OFFEN", driverId: null },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const weitere = gefunden.length > limit;
  const rows = weitere ? gefunden.slice(0, limit) : gefunden;
  const offenGesamt = await prisma.booking.count({
    where: { dispatchMode: "ADMIN", status: "OFFEN", driverId: null },
  });

  const pool = rows.map((b) => ({
    id: b.id,
    // Kein Name, keine Einrichtung, keine Fahrtart: das sind Gesundheitsdaten
    // einer bestimmbaren Person und gehen fremde Zentralen nichts an.
    pickupArea: grobeLage(b.pickupAddress),
    destArea: grobeLage(b.destAddress),
    // Anforderungen ans Fahrzeug bleiben - ohne sie kann niemand entscheiden,
    // ob er die Fahrt ueberhaupt bedienen kann.
    vehicleClass: b.vehicleClass,
    vehicleClassLabel: vehicleClassInfo(b.vehicleClass).label,
    vehicleClassIcon: vehicleClassInfo(b.vehicleClass).icon,
    requiresRamp: b.requiresRamp ?? false,
    requiresStretcher: b.requiresStretcher ?? false,
    scheduledAt: b.scheduledAt ? b.scheduledAt.toISOString() : null,
    isScheduled: b.isScheduled,
    distanceMeters: b.distanceMeters ?? null,
    createdAt: b.createdAt.toISOString(),
  }));
  // Der Pool zeigt Fahrten FREMDER Einrichtungen quer ueber alle Zentralen.
  // Auch in der datensparsamen Fassung gehoert dieser Zugriff protokolliert.
  await logAccess({
    actorType: "ADMIN",
    companyId: session.companyId,
    actorId: session.companyId,
    action: "VIEW",
    entity: "BOOKING",
    detail: `Krankenfahrten-Pool eingesehen (${rows.length} von ${offenGesamt})`,
  });

  return NextResponse.json({
    pool,
    total: offenGesamt,
    nextCursor: weitere ? rows[rows.length - 1]?.id ?? null : null,
  });
}

const assignSchema = z.object({ bookingId: z.string(), driverId: z.string() });

// Pool-Fahrt einem eigenen Fahrer zuweisen (Annahme der Vorbestellung).
export async function POST(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  // Abo-Sperre: gekuendigt oder ueberfaellig -> keine betriebsrelevanten
  // Aenderungen mehr. Lesen bleibt erlaubt (Rechnungen, Belege, Abo-Seite).
  const abo = await aboGesperrt(session.companyId);
  if (abo) return abo;
  let json: any;
  try { json = await req.json(); } catch { return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 }); }
  // Ohne Bremse liesse sich der firmenuebergreifende Pool im Sekundentakt
  // leerraeumen.
  if (!rateLimit(`pool-assign:${session.companyId}`, 60, 10 * 60_000).ok) {
    return NextResponse.json({ error: "Zu viele Zuweisungen in kurzer Zeit." }, { status: 429 });
  }
  const parsed = assignSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "bookingId und driverId erforderlich." }, { status: 400 });

  // Fahrer muss zur eigenen Zentrale gehören.
  const driver = await prisma.driver.findUnique({ where: { id: parsed.data.driverId }, select: { id: true, companyId: true, name: true } });
  if (!driver || driver.companyId !== session.companyId) {
    return NextResponse.json({ error: "Fahrer gehört nicht zu Ihrer Zentrale." }, { status: 403 });
  }

  const dispatcher = getDispatcher();
  if (!dispatcher) return NextResponse.json({ error: "Dispositionsdienst nicht verfügbar." }, { status: 503 });
  const res = await dispatcher.assignFromPool(parsed.data.bookingId, driver.id, session.companyId);
  if (!res.ok) return NextResponse.json({ error: res.reason ?? "Zuweisung fehlgeschlagen." }, { status: 409 });

  await logAccess({ actorType: "ADMIN", companyId: session.companyId, actorId: session.companyId, action: "UPDATE", entity: "BOOKING", entityId: parsed.data.bookingId, detail: `Pool-Fahrt zugewiesen an ${driver.name}` });
  return NextResponse.json({ ok: true });
}
