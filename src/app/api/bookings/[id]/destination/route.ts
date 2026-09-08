import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getDispatcher } from "@/server/runtime";
import { bookingDTO } from "@/server/serialize";
import { getSession } from "@/lib/session";
import { bookingRefWhereCustomer } from "@/lib/bookingRef";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Koordinaten muessen auf der Erde liegen. Ohne Grenzen landete jede
// Fantasiezahl in der Streckenberechnung und erzeugte Preise aus dem Nichts.
const place = z.object({
  address: z.string().trim().min(1).max(300),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

// Luftlinie in Kilometern (Haversine).
function luftlinieKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const bog = (g: number) => (g * Math.PI) / 180;
  const dLat = bog(bLat - aLat);
  const dLng = bog(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(bog(aLat)) * Math.cos(bog(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Weiter als das ist keine Taxifahrt mehr, sondern ein Tippfehler oder
// Mutwille. Der Fahrgast soll in so einem Fall die Zentrale anrufen.
const MAX_ENTFERNUNG_KM = 300;

// Dieselbe Obergrenze wie beim Buchen (stops.max(8)).
const MAX_STOPPS = 8;

const schema = z
  .object({
    // Neues Endziel ...
    dest: place.optional(),
    // ... und/oder ein zusaetzlicher Zwischenstopp.
    addStop: place.optional(),
  })
  .refine((d) => !!d.dest || !!d.addStop, {
    message: "Bitte ein neues Ziel oder einen Zwischenstopp angeben.",
  });

/**
 * Zieländerung während der Fahrt (Phase 2f). Setzt ein neues Endziel und/oder
 * fügt einen Zwischenstopp hinzu; Strecke, Dauer und Preis werden automatisch
 * über die komplette Route neu berechnet. Erlaubt bis zum Fahrtende.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const booking = await prisma.booking.findFirst({ where: bookingRefWhereCustomer(params.id, getSession("customer")?.sub) });
  if (!booking) {
    return NextResponse.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
  }
  if (booking.status === "ABGESCHLOSSEN" || booking.status === "STORNIERT") {
    return NextResponse.json({ error: "Diese Fahrt kann nicht mehr geändert werden." }, { status: 409 });
  }
  // Ist bereits abgerechnet, wuerde eine Zieländerung den Preis einer schon
  // bezahlten Fahrt verschieben.
  if (booking.paymentStatus === "BEZAHLT") {
    return NextResponse.json(
      { error: "Diese Fahrt ist bereits bezahlt und kann nicht mehr geändert werden." },
      { status: 409 },
    );
  }
  // Der Verfolgungs-Link wandert per SMS durch fremde Hände. Eine Handvoll
  // Änderungen je Fahrt ist normal, hunderte sind es nicht - jede loest eine
  // vollstaendige Neuberechnung der Strecke aus.
  const takt = rateLimit(`ziel:${booking.id}`, 10, 30 * 60_000);
  if (!takt.ok) {
    return NextResponse.json(
      { error: "Zu viele Zieländerungen. Bitte rufen Sie die Zentrale an." },
      { status: 429 },
    );
  }

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bitte ein neues Ziel oder einen Zwischenstopp angeben.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Zwischenstopps: dieselbe Obergrenze wie beim Buchen. Ueber die
  // Zieländerung liessen sich sonst beliebig viele nachschieben - die
  // Zehnerbremse begrenzt nur das Tempo, nicht die Gesamtzahl.
  if (parsed.data.addStop) {
    const bisher = (() => {
      try {
        const roh = JSON.parse((booking.stops as string) ?? "[]");
        return Array.isArray(roh) ? roh.length : 0;
      } catch {
        return 0;
      }
    })();
    if (bisher >= MAX_STOPPS) {
      return NextResponse.json(
        { error: `Mehr als ${MAX_STOPPS} Zwischenstopps sind nicht möglich. Bitte rufen Sie die Zentrale an.` },
        { status: 409 },
      );
    }
  }

  // Plausibilitaet: das neue Ziel muss im Umkreis der Abholung liegen.
  const zuWeit = [parsed.data.dest, parsed.data.addStop].some(
    (p) => p && luftlinieKm(booking.pickupLat, booking.pickupLng, p.lat, p.lng) > MAX_ENTFERNUNG_KM,
  );
  if (zuWeit) {
    return NextResponse.json(
      { error: `Das Ziel liegt weiter als ${MAX_ENTFERNUNG_KM} km entfernt. Bitte rufen Sie die Zentrale an.` },
      { status: 400 },
    );
  }

  const dispatcher = getDispatcher();
  if (!dispatcher) {
    return NextResponse.json({ error: "Dienst nicht verfügbar." }, { status: 503 });
  }

  // Explizite Literale: zod-Inferenz liefert ohne strictNullChecks optionale Felder.
  const dest = parsed.data.dest
    ? { address: parsed.data.dest.address, lat: parsed.data.dest.lat, lng: parsed.data.dest.lng }
    : undefined;
  const addStop = parsed.data.addStop
    ? { address: parsed.data.addStop.address, lat: parsed.data.addStop.lat, lng: parsed.data.addStop.lng }
    : undefined;
  const r = await dispatcher.changeDestination(booking.id, { dest, addStop });
  if (!r.ok) {
    const status = r.error?.includes("nicht gefunden") ? 404 : 409;
    return NextResponse.json({ error: r.error ?? "Änderung fehlgeschlagen." }, { status });
  }

  // Sicherheitshalber frisch laden (Dispatcher liefert DTO bereits zurueck).
  const fresh = await prisma.booking.findUnique({
    where: { id: booking.id },
    include: { driver: true },
  });
  return NextResponse.json({ ok: true, booking: r.booking ?? (fresh ? bookingDTO(fresh) : null) });
}
