import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { portalCan } from "@/lib/portalRoles";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug, classFactorForSlug, applyClassFactor } from "@/lib/pricing";
import { getPlatformRate, approxFare } from "@/lib/platformRate";
import { normalizeClass } from "@/lib/vehicleClasses";
import { sendSms } from "@/lib/notify";
import { getDispatcher } from "@/server/runtime";
import { bookingDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

const point = z.object({ address: z.string().min(1), lat: z.number(), lng: z.number() });
const schema = z.object({
  guestName: z.string().min(1).max(120),
  guestPhone: z.string().max(40).optional().nullable(),
  roomNumber: z.string().max(20).optional().nullable(),
  hotelPayment: z.enum(["DIRECT", "ROOM", "CORPORATE"]).optional(),
  pickup: point,
  dest: point,
  vehicleClass: z.string().optional().nullable(),
  isVip: z.boolean().optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
});

// Fahrten dieses Hotels (neueste zuerst).
export async function GET() {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const bookings = await prisma.booking.findMany({
    where: { hotelId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { driver: true },
  });
  return NextResponse.json({ rides: bookings.map((b) => bookingDTO(b)) });
}

// Guestless-Buchung: Rezeption bucht für einen Gast; der Gast erhält per SMS
// einen Tracking-Link (keine App nötig). Hotel ist vertrauenswürdig -> keine
// Telefon-Verifizierung.
export async function POST(req: Request) {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  // Rollen-Gating: z. B. Buchhaltung darf keine Fahrten buchen.
  if (!portalCan(session.portalRole, "book")) return NextResponse.json({ error: "Ihre Rolle darf keine Fahrten buchen." }, { status: 403 });
  const hotel = await prisma.hotel.findUnique({ where: { id: session.sub } });
  if (!hotel) return NextResponse.json({ error: "Hotel nicht gefunden" }, { status: 401 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte Gast, Strecke und Daten angeben." }, { status: 400 });
  const d = parsed.data;

  // VIP-Layer: Luxusfahrzeug (VIP-Klasse) erzwingen.
  const isVip = d.isVip ?? false;
  const vehicleClass = isVip ? "VIP" : normalizeClass(d.vehicleClass ?? "STANDARD");
  const pricing = await pricingForSlug(undefined);
  const est = await estimatePriceViaWith([{ lat: d.pickup.lat, lng: d.pickup.lng }, { lat: d.dest.lat, lng: d.dest.lng }], pricing);
  const factor = await classFactorForSlug(undefined, vehicleClass);
  const rate = await getPlatformRate();

  const scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
  const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now() + 60_000;

  const booking = await prisma.booking.create({
    data: {
      hotelId: hotel.id,
      roomNumber: d.roomNumber ?? null,
      hotelPayment: d.hotelPayment ?? "DIRECT",
      preferredCompanyIds: hotel.preferredCompanyIds ?? "",
      isVip,
      customerName: d.guestName,
      customerPhone: (d.guestPhone ?? hotel.phone ?? "").trim() || "—",
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
    include: { driver: true },
  });

  if (!isScheduled) getDispatcher()?.dispatchBooking(booking.id).catch(() => {});

  // Guestless: Tracking-Link per SMS an den Gast (ohne Twilio-Key -> Mock-Log).
  let smsSent = false;
  if (d.guestPhone && d.guestPhone.trim()) {
    const url = `${new URL(req.url).origin}/verfolgen/${booking.trackingToken ?? booking.id}`;
    const body = `${hotel.name}: Ihr Taxi ist bestellt. Live verfolgen: ${url}`;
    const r = await sendSms(d.guestPhone.trim(), body).catch(() => null);
    smsSent = !!r?.ok;
  }

  return NextResponse.json({ id: booking.id, ride: bookingDTO(booking), smsSent }, { status: 201 });
}
