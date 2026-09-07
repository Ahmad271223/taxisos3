import { NextResponse } from "next/server";
import { alarm } from "@/server/alarm";
import { rateLimit } from "@/lib/ratelimit";
import { portalCan } from "@/lib/portalRoles";

// Unterkonten eines Veranstalters (portalRole) hatten bisher dieselben Rechte
// wie der Inhaber: die Sitzung laeuft aus technischen Gruenden unter der ID
// des Hauptkontos, und geprueft wurde die Rolle nirgends. Eine Kraft mit
// der Rolle "Buchhaltung" konnte damit Rabattcodes anlegen und Fahrten
// buchen. Jetzt entscheidet portalCan() ueber jeden schreibenden Zugriff.
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug, classFactorForSlug, applyClassFactor } from "@/lib/pricing";
import { getPlatformRate, approxFare } from "@/lib/platformRate";
import { normalizeClass } from "@/lib/vehicleClasses";
import { getDispatcher } from "@/server/runtime";

export const dynamic = "force-dynamic";

const point = z.object({ address: z.string().min(1), lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) });
const schema = z.object({
  eventId: z.string().min(1),
  pickup: point,
  dest: point,
  pickupPoint: z.string().max(120).optional().nullable(),
  vehicleClass: z.string().optional().nullable(),
  count: z.number().int().min(1).max(30).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
});

// Sammelbuchung: bucht mehrere Taxis für eine Veranstaltung in einem Rutsch.
export async function POST(req: Request) {
  // Ein einzelnes Konto kann hier viel Last erzeugen (bis zu 30 Fahrten je Anfrage). Die Bremse
  // haengt am Konto, nicht an der IP - eine Einrichtung sitzt hinter
  // einem gemeinsamen Anschluss.
  // Ohne Dispatcher wuerde die Fahrt angelegt, aber nie gesucht - der Kunde
  // saehe endlos "Fahrer wird gesucht". Dann lieber ehrlich ablehnen.
  if (!getDispatcher()) {
    return NextResponse.json({ error: "Vermittlung gerade nicht erreichbar. Bitte in einer Minute erneut versuchen." }, { status: 503 });
  }
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!rateLimit(`event-book:${session.sub}`, 20, 60 * 60_000).ok) {
    return NextResponse.json({ error: "Zu viele Aufträge in kurzer Zeit. Bitte kurz warten." }, { status: 429 });
  }
  if (!portalCan(session.portalRole, "book")) {
    return NextResponse.json({ error: "Ihre Rolle darf keine Fahrten buchen." }, { status: 403 });
  }
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte Event, Strecke und Anzahl angeben." }, { status: 400 });
  const d = parsed.data;

  const event = await prisma.event.findUnique({ where: { id: d.eventId }, select: { id: true, eventHostId: true, name: true } });
  if (!event || event.eventHostId !== session.sub) return NextResponse.json({ error: "Event nicht gefunden" }, { status: 404 });

  const vehicleClass = normalizeClass(d.vehicleClass ?? "STANDARD");
  const pricing = await pricingForSlug(undefined);
  const est = await estimatePriceViaWith([{ lat: d.pickup.lat, lng: d.pickup.lng }, { lat: d.dest.lat, lng: d.dest.lng }], pricing);
  const factor = await classFactorForSlug(undefined, vehicleClass);
  const rate = await getPlatformRate();
  const scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
  const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now() + 60_000;
  const count = d.count ?? 1;

  // ALLES ODER NICHTS: Frueher wurde jede der bis zu 30 Fahrten einzeln
  // angelegt. Ging die 18. schief, blieben 17 echte Buchungen stehen, waehrend
  // der Anfrage ein Fehler gemeldet wurde – der Veranstalter drueckte erneut
  // und hatte am Ende 47 Fahrten. In einer Transaktion verschwindet bei einem
  // Fehler wieder alles, und der Veranstalter kann bedenkenlos wiederholen.
  //
  // Die Vermittlung laeuft BEWUSST erst nach dem Festschreiben: sie wirkt nach
  // aussen (Fahrer werden benachrichtigt) und liesse sich nicht zuruecknehmen.
  const ids = await prisma.$transaction(async (tx) => {
    const angelegt: string[] = [];
    for (let i = 1; i <= count; i++) {
      const b = await tx.booking.create({
        data: {
          eventId: event.id,
          pickupPoint: d.pickupPoint ?? null,
          customerName: `${event.name} · Taxi ${i}/${count}`,
          customerPhone: "—",
          pickupAddress: d.pickup.address,
          pickupLat: d.pickup.lat,
          pickupLng: d.pickup.lng,
          destAddress: d.dest.address,
          destLat: d.dest.lat,
          destLng: d.dest.lng,
          vehicleClass,
          isScheduled,
          scheduledAt,
          distanceMeters: est.distanceMeters,
          durationSeconds: est.durationSeconds,
          priceMin: applyClassFactor(est.priceMin, factor),
          priceMax: applyClassFactor(est.priceMax, factor),
          priceApprox: applyClassFactor(approxFare(rate, est.distanceMeters, est.durationSeconds), factor),
          tariff: est.tariff,
          status: "OFFEN",
          trackingStatus: isScheduled ? "GEPLANT" : "SUCHE",
          paymentMethod: "CASH",
        },
        select: { id: true },
      });
      angelegt.push(b.id);
    }
    return angelegt;
  });

  // Erst jetzt vermitteln – die Fahrten stehen unwiderruflich in der Datenbank.
  if (!isScheduled) {
    for (const id of ids) {
      getDispatcher()
        ?.dispatchBooking(id)
        // Der Fehler wurde frueher stillschweigend verworfen: die Fahrt stand
        // in der Datenbank, aber niemand suchte je einen Fahrer, und die
        // Anfrage meldete trotzdem Erfolg.
        .catch((e: any) => {
          console.error(`Vermittlung fehlgeschlagen (${id}):`, e?.message ?? e);
          alarm("warnung", `dispatch:${id}`, "Vermittlung fehlgeschlagen", {
            hinweis: `Event-Sammelfahrt ${id} wurde angelegt, aber die Vermittlung schlug fehl: ${e?.message ?? e}`,
          });
        });
    }
  }

  return NextResponse.json({ ok: true, count: ids.length, ids }, { status: 201 });
}
