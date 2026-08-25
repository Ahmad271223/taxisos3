import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getDispatcher } from "@/server/runtime";
import { bookingDTO } from "@/server/serialize";
import { getSession } from "@/lib/session";
import { bookingRefWhereCustomer } from "@/lib/bookingRef";

export const dynamic = "force-dynamic";

const place = z.object({ address: z.string().min(1), lat: z.number(), lng: z.number() });

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
