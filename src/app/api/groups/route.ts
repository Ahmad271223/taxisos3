import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug, classFactorForSlug, applyClassFactor } from "@/lib/pricing";
import { buildFleet, MAX_GROUP_VEHICLES, normalizeClass } from "@/lib/vehicleClasses";
import { getPlatformRate, approxFare } from "@/lib/platformRate";
import { normalizeTarget, phoneVerificationRequired, verifyVerifyToken } from "@/lib/verify";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { getSession } from "@/lib/session";
import { getDispatcher } from "@/server/runtime";
import { checkBookingPreconditions } from "@/lib/bookingGuard";
import { groupDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

const point = z.object({ lat: z.number(), lng: z.number() });

const schema = z.object({
  customerName: z.string().min(1),
  customerPhone: z.string().min(3),
  pickupAddress: z.string().min(1),
  pickup: point,
  destAddress: z.string().min(1),
  dest: point,
  vehicles: z
    .array(z.object({ vehicleClass: z.string(), count: z.number().int().min(1).max(MAX_GROUP_VEHICLES) }))
    .min(1),
  totalPassengers: z.number().int().min(1).max(800).optional(),
  totalLuggage: z.number().int().min(0).max(800).optional(),
  eventLabel: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  paymentMethod: z.enum(["CASH", "CARD"]).optional(),
  // Gespeicherte Karte fuer alle Fahrten dieser Gruppe.
  cardId: z.string().optional().nullable(),
  verificationToken: z.string().optional().nullable(),
});

// Verteilt Personen möglichst gleichmäßig auf die Fahrzeuge (mind. 1 je Fahrzeug).
function distribute(total: number, count: number): number[] {
  const base = Math.floor(total / count);
  let rest = total - base * count;
  return Array.from({ length: count }, () => {
    const extra = rest > 0 ? 1 : 0;
    if (rest > 0) rest--;
    return Math.max(1, base + extra);
  });
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (ip) {
    const r = rateLimit(`group:ip:${ip}`, 10, 10 * 60_000);
    if (!r.ok) return NextResponse.json({ error: "Zu viele Gruppenbuchungen. Bitte später erneut." }, { status: 429 });
  }

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte alle Pflichtfelder ausfüllen", details: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  // Zahlart: identisch zur Einzelfahrt – Bar oder Kartenzahlung mit
  // gespeicherter Karte. Abgebucht wird jede Fahrt einzeln NACH ihrem Ende.
  const paymentMethod = d.paymentMethod === "CARD" ? "CARD" : "CASH";

  // Flotte normalisieren/validieren.
  const fleet = buildFleet(d.vehicles.map((v) => ({ classKey: v.vehicleClass, count: v.count })));
  if (fleet.vehicleCount < 1) {
    return NextResponse.json({ error: "Mindestens ein Fahrzeug erforderlich." }, { status: 400 });
  }
  if (fleet.vehicleCount > MAX_GROUP_VEHICLES) {
    return NextResponse.json({ error: `Maximal ${MAX_GROUP_VEHICLES} Fahrzeuge pro Buchung.` }, { status: 400 });
  }

  // Eingeloggter Kunde -> Gruppe zuordnen; bestätigte Kontonummer überspringt SMS.
  let customerId: string | null = null;
  let phoneAlreadyVerified = false;
  const customerSession = getSession("customer");
  if (customerSession) {
    const cust = await prisma.customer.findUnique({ where: { id: customerSession.sub } });
    if (cust) {
      customerId = cust.id;
      if (normalizeTarget("SMS", cust.phone) === normalizeTarget("SMS", d.customerPhone)) {
        phoneAlreadyVerified = true;
      }
    }
  }

  // Telefon-Verifizierung (einmal für die ganze Gruppe).
  if (phoneVerificationRequired() && !phoneAlreadyVerified) {
    const expected = normalizeTarget("SMS", d.customerPhone);
    const proof = verifyVerifyToken(d.verificationToken, { channel: "SMS", target: expected });
    if (!proof) {
      return NextResponse.json(
        { error: "Telefonnummer nicht bestätigt. Bitte zuerst den SMS-Code verifizieren.", code: "VERIFICATION_REQUIRED" },
        { status: 403 },
      );
    }
  }

  // Vorpruefung wie bei der Einzelfahrt: Kartenzahlung erfordert ein Konto
  // mit hinterlegter, gueltiger Karte. Es wird nichts reserviert.
  const guard = await checkBookingPreconditions({
    paymentMethod: paymentMethod as any,
    customerId,
    phoneVerified: true, // oben bereits geprueft
    requestedCardId: d.cardId,
  });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error, code: guard.code }, { status: guard.status });
  }
  const groupCardId = guard.card?.id ?? null;
  const groupPaymentStatus = paymentMethod === "CARD" ? "KARTE_HINTERLEGT" : "OFFEN";

  const totalPassengers = d.totalPassengers ?? fleet.totalSeats;
  const totalLuggage = d.totalLuggage ?? 0;

  // Strecke + Basis-Preis einmal berechnen (Plattform-Tarif, Direktfahrt).
  const pricing = await pricingForSlug(undefined);
  const points = [
    { lat: d.pickup.lat, lng: d.pickup.lng },
    { lat: d.dest.lat, lng: d.dest.lng },
  ];
  const estimate = await estimatePriceViaWith(points, pricing);
  const rate = await getPlatformRate();
  const baseApprox = approxFare(rate, estimate.distanceMeters, estimate.durationSeconds);

  const scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
  const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now() + 60_000;

  // Eltern-Datensatz anlegen.
  const group = await prisma.bookingGroup.create({
    data: {
      customerName: d.customerName,
      customerPhone: d.customerPhone,
      customerId,
      pickupAddress: d.pickupAddress,
      pickupLat: d.pickup.lat,
      pickupLng: d.pickup.lng,
      destAddress: d.destAddress,
      destLat: d.dest.lat,
      destLng: d.dest.lng,
      isScheduled,
      scheduledAt,
      vehicleCount: fleet.vehicleCount,
      totalPassengers,
      totalLuggage,
      eventLabel: d.eventLabel ?? null,
      notes: d.notes ?? null,
      paymentMethod,
    },
  });

  // Flotte in eine flache Fahrzeugliste auflösen + Personen verteilen.
  const flat: string[] = [];
  for (const v of fleet.vehicles) for (let i = 0; i < v.count; i++) flat.push(v.classKey);
  const paxSplit = distribute(totalPassengers, flat.length);
  const luggageEach = totalLuggage > 0;

  const created: any[] = [];
  for (let i = 0; i < flat.length; i++) {
    const vehicleClass = normalizeClass(flat[i]);
    const factor = await classFactorForSlug(undefined, vehicleClass);
    const priceMin = applyClassFactor(estimate.priceMin, factor);
    const priceMax = applyClassFactor(estimate.priceMax, factor);
    const priceApprox = applyClassFactor(baseApprox, factor);
    const booking = await prisma.booking.create({
      data: {
        groupId: group.id,
        companyId: null,
        customerName: d.customerName,
        customerPhone: d.customerPhone,
        customerId,
        pickupAddress: d.pickupAddress,
        pickupLat: d.pickup.lat,
        pickupLng: d.pickup.lng,
        destAddress: d.destAddress,
        destLat: d.dest.lat,
        destLng: d.dest.lng,
        passengers: paxSplit[i],
        luggage: luggageEach,
        vehicleClass,
        notes: d.notes ?? null,
        isScheduled,
        scheduledAt,
        distanceMeters: estimate.distanceMeters,
        durationSeconds: estimate.durationSeconds,
        priceMin,
        priceMax,
        priceApprox,
        tariff: estimate.tariff,
        status: "OFFEN",
        trackingStatus: isScheduled ? "GEPLANT" : "SUCHE",
        paymentMethod,
        paymentStatus: groupPaymentStatus,
        cardId: groupCardId,
      },
    });
    created.push(booking);
  }

  // Jedes Fahrzeug einzeln disponieren (außer Vorbestellung).
  if (!isScheduled) {
    const dispatcher = getDispatcher();
    for (const b of created) dispatcher?.dispatchBooking(b.id).catch(() => {});
  }

  return NextResponse.json({ id: group.id, group: groupDTO(group, created) }, { status: 201 });
}
