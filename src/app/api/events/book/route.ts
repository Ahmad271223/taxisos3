import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug, classFactorForSlug, applyClassFactor } from "@/lib/pricing";
import { getPlatformRate, approxFare } from "@/lib/platformRate";
import { normalizeClass } from "@/lib/vehicleClasses";
import { getDispatcher } from "@/server/runtime";

export const dynamic = "force-dynamic";

const point = z.object({ address: z.string().min(1), lat: z.number(), lng: z.number() });
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
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
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

  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const booking = await prisma.booking.create({
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
    ids.push(booking.id);
    if (!isScheduled) getDispatcher()?.dispatchBooking(booking.id).catch(() => {});
  }

  return NextResponse.json({ ok: true, count: ids.length, ids }, { status: 201 });
}
