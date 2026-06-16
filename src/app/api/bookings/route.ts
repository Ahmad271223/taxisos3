import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug, classFactorForSlug, applyClassFactor } from "@/lib/pricing";
import { normalizeClass } from "@/lib/vehicleClasses";
import { airportPickupTime } from "@/lib/flights";
import { meetGreetFee } from "@/lib/airportExtras";
import { promoUsable, promoDiscountAmount } from "@/lib/promo";
import { normalizeMedicalType, medicalDetailsSchema, medicalDetailsData } from "@/lib/medical";
import { serializeStops } from "@/lib/stops";
import { authorizePayment, paymentEnabled, retrieveIntent } from "@/lib/stripe";
import { normalizeTarget, phoneVerificationRequired, verifyVerifyToken } from "@/lib/verify";
import { getPlatformRate, approxFare } from "@/lib/platformRate";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { getSession } from "@/lib/session";
import { getDispatcher } from "@/server/runtime";
import { bookingDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

const point = z.object({ lat: z.number(), lng: z.number() });
const stop = z.object({ address: z.string().min(1), lat: z.number(), lng: z.number() });

const schema = z.object({
  // Plattform-Buchung: Firma optional, das System sucht den nächsten freien Fahrer
  // über alle Unternehmen hinweg (Radius-Dispatch).
  company: z.string().min(1).optional().nullable(),
  customerName: z.string().min(1),
  customerPhone: z.string().min(3),
  pickupAddress: z.string().min(1),
  pickup: point,
  destAddress: z.string().min(1),
  dest: point,
  // Mehrziel-Vorabplanung (Phase 2e): Zwischenstopps zwischen Abholung und Ziel.
  stops: z.array(stop).max(8).optional(),
  passengers: z.number().int().min(1).max(8).optional(),
  luggage: z.boolean().optional(),
  childSeat: z.boolean().optional(),
  // Gewünschte Fahrzeugklasse (Phase 12 Marktplatz). Ungültig/leer -> STANDARD.
  vehicleClass: z.string().optional().nullable(),
  // Krankenfahrt-Kategorie (Phase 15), optional.
  medicalType: z.string().optional().nullable(),
  // Krankenfahrt-Details (Phase B) + Fahrzeug-Anforderungen (Phase D).
  ...medicalDetailsSchema,
  returnAt: z.string().datetime().optional().nullable(),
  // Buchung im Auftrag einer Einrichtung (Phase E).
  institutionId: z.string().optional().nullable(),
  // Gezielt gewähltes Taxi von der Live-Karte (Phase 23).
  requestedDriverId: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  // Flughafen-Modul (Phase 14): an einen Flug gekoppelte Fahrt.
  flightNumber: z.string().max(10).optional().nullable(),
  flightDirection: z.enum(["ARRIVAL", "DEPARTURE"]).optional().nullable(),
  terminal: z.string().max(20).optional().nullable(),
  flightStatus: z.string().max(20).optional().nullable(),
  flightScheduledAt: z.string().datetime().optional().nullable(),
  flightDelayMinutes: z.number().int().min(0).max(2880).optional().nullable(),
  // Airport Meet & Greet Service-Stufe.
  meetGreet: z.enum(["BASIC", "TERMINAL", "PREMIUM"]).optional().nullable(),
  // Event-Promo-Code (Mass Mobility).
  promoCode: z.string().max(30).optional().nullable(),
  paymentMethod: z.enum(["CASH", "CARD"]).optional(),
  // Nachweis der Gast-Telefon-Verifizierung (Phase 3h).
  verificationToken: z.string().optional().nullable(),
  // Vom Client autorisierter Stripe-PaymentIntent (Phase, echte Kartenzahlung).
  paymentIntentId: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  // Rate-Limit (nur hinter Proxy/Ingress): Buchungs-Spam bremsen.
  const ip = clientIp(req);
  if (ip) {
    const r = rateLimit(`book:ip:${ip}`, 30, 10 * 60_000);
    if (!r.ok) return NextResponse.json({ error: "Zu viele Buchungen. Bitte später erneut." }, { status: 429 });
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

  // Eingeloggter Kunde? -> Buchung dem Konto zuordnen; wenn die Buchungsnummer
  // der bestätigten Kontonummer entspricht, ist keine erneute SMS-Verifizierung nötig.
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

  // Gast-Telefon-Verifizierung (Phase 3h): vor Dispatch verpflichtend (außer
  // der eingeloggte Kunde bucht mit seiner bereits bestätigten Kontonummer).
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

  // Optional: Plattform-Buchung ohne Firma (Standard).
  let companyId: string | null = null;
  if (d.company) {
    const company = await prisma.company.findUnique({ where: { slug: d.company } });
    if (!company) {
      return NextResponse.json({ error: "Unbekanntes Unternehmen" }, { status: 404 });
    }
    companyId = company.id;
  }

  // Plattform-Tarif (Standard) bzw. Firmen-Tarif, falls explizit Firma gewählt.
  const pricing = await pricingForSlug(d.company ?? undefined);
  // Gesamtpreis ueber Abholung -> Zwischenstopps -> Ziel (Mehrziel, Phase 2e).
  const stops = (d.stops ?? []).map((s) => ({ address: s.address, lat: s.lat, lng: s.lng }));
  const points = [
    { lat: d.pickup.lat, lng: d.pickup.lng },
    ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    { lat: d.dest.lat, lng: d.dest.lng },
  ];
  const estimate = await estimatePriceViaWith(points, pricing);

  // Fahrzeugklassen-Faktor (Phase 12): skaliert den Preis je gewählter Klasse.
  // Plattform-Buchung -> Plattform-Standardfaktor; explizite Firma -> Firmenfaktor.
  const vehicleClass = normalizeClass(d.vehicleClass);
  const classF = await classFactorForSlug(d.company ?? undefined, vehicleClass);
  // Meet & Greet Aufschlag (Airport): flughafenabhängig, in den Preis einrechnen.
  const mgFee = meetGreetFee(d.meetGreet, d.pickupAddress, d.destAddress);
  const priceMin = applyClassFactor(estimate.priceMin, classF) + mgFee;
  const priceMax = applyClassFactor(estimate.priceMax, classF) + mgFee;

  // „ca."-Vorabpreis (Plattform-Durchschnitt) – gilt bis ein Fahrer feststeht.
  const rate = await getPlatformRate();
  const priceApprox = applyClassFactor(approxFare(rate, estimate.distanceMeters, estimate.durationSeconds), classF) + mgFee;

  // Event-Promo-Code (Mass Mobility): Rabatt auf den Vorabpreis. Gültiger Code
  // -> Rabatt berechnen, Nutzung hochzählen, Endpreis später entsprechend mindern.
  let promoCode: string | null = null;
  let promoDiscount = 0;
  if (d.promoCode) {
    const code = d.promoCode.toUpperCase().replace(/\s+/g, "");
    const promo = await prisma.promoCode.findUnique({ where: { code } });
    if (promo && promoUsable(promo)) {
      promoCode = code;
      promoDiscount = promoDiscountAmount(promo, priceApprox);
      await prisma.promoCode.update({ where: { code }, data: { usedCount: { increment: 1 } } }).catch(() => {});
    }
  }
  const priceApproxNet = Math.max(0, Math.round((priceApprox - promoDiscount) * 100) / 100);

  // Flughafen-Modul (Phase 14): bei ANKUNFT ergibt sich die Abholzeit aus der
  // geplanten Landung + Verspätung + Gepäckpuffer. Sonst gilt die gewählte Zeit.
  const flightScheduledAt = d.flightScheduledAt ? new Date(d.flightScheduledAt) : null;
  const flightDelayMinutes = d.flightDelayMinutes ?? 0;
  let scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
  if (d.flightDirection === "ARRIVAL" && flightScheduledAt) {
    scheduledAt = airportPickupTime(flightScheduledAt, "ARRIVAL", flightDelayMinutes);
  }
  const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now() + 60_000;

  // Kartenzahlung (Authorize-then-Capture). Belastet wird erst nach Fahrtende.
  const paymentMethod = d.paymentMethod ?? "CASH";
  let paymentStatus = "OFFEN";
  let paymentRef: string | null = null;
  let priceAuthorized: number | null = null;
  if (paymentMethod === "CARD") {
    if (paymentEnabled()) {
      // Echter Stripe-Modus: der Client hat den PaymentIntent bereits mit der
      // Karte autorisiert -> serverseitig verifizieren (Status requires_capture).
      if (!d.paymentIntentId) {
        return NextResponse.json({ error: "Kartenzahlung nicht autorisiert.", code: "PAYMENT_REQUIRED" }, { status: 402 });
      }
      const pi = await retrieveIntent(d.paymentIntentId);
      const okHold = pi && pi.status === "requires_capture";
      const enough = pi && pi.amount >= Math.round((priceMin ?? 0) * 100);
      if (!okHold || !enough) {
        return NextResponse.json(
          { error: "Kartenautorisierung ungültig oder unzureichend.", code: "PAYMENT_INVALID" },
          { status: 402 },
        );
      }
      paymentRef = pi.id;
      priceAuthorized = Math.round((pi.amount / 100) * 100) / 100;
      paymentStatus = "AUTORISIERT";
    } else {
      // Mock (kein Stripe-Key): wie bisher, damit lokaler Flow/Tests laufen.
      const auth = await authorizePayment(priceMax, { kind: "taxi_ride" });
      paymentStatus = auth.status;
      paymentRef = auth.ref;
      if (auth.ok) priceAuthorized = priceMax;
    }
  }

  const booking = await prisma.booking.create({
    data: {
      companyId,
      customerName: d.customerName,
      customerPhone: d.customerPhone,
      customerId,
      pickupAddress: d.pickupAddress,
      pickupLat: d.pickup.lat,
      pickupLng: d.pickup.lng,
      destAddress: d.destAddress,
      destLat: d.dest.lat,
      destLng: d.dest.lng,
      stops: serializeStops(stops),
      passengers: d.passengers ?? 1,
      luggage: d.luggage ?? false,
      childSeat: d.childSeat ?? false,
      vehicleClass,
      medicalType: normalizeMedicalType(d.medicalType),
      ...medicalDetailsData(d),
      returnAt: d.returnAt ? new Date(d.returnAt) : null,
      institutionId: d.institutionId ?? null,
      requestedDriverId: d.requestedDriverId ?? null,
      notes: d.notes ?? null,
      isScheduled,
      scheduledAt,
      flightNumber: d.flightNumber ?? null,
      flightDirection: d.flightDirection ?? null,
      terminal: d.terminal ?? null,
      flightStatus: d.flightStatus ?? null,
      flightScheduledAt,
      flightDelayMinutes,
      meetGreet: d.meetGreet ?? null,
      meetGreetFee: mgFee || null,
      distanceMeters: estimate.distanceMeters,
      durationSeconds: estimate.durationSeconds,
      priceMin,
      priceMax,
      priceApprox: priceApproxNet,
      promoCode,
      promoDiscount: promoDiscount || null,
      tariff: estimate.tariff,
      status: "OFFEN",
      trackingStatus: isScheduled ? "GEPLANT" : "SUCHE",
      paymentMethod,
      paymentStatus,
      paymentRef,
      priceAuthorized,
    },
  });

  if (!isScheduled) {
    getDispatcher()?.dispatchBooking(booking.id).catch(() => {});
  }

  // Automatische Rückfahrt (Phase B): zweite, geplante Buchung mit vertauschter
  // Strecke zum gewünschten Zeitpunkt. Zahlung als CASH (kein zweiter Karten-Hold).
  let returnBookingId: string | null = null;
  if (d.returnAt) {
    const retAt = new Date(d.returnAt);
    if (retAt.getTime() > Date.now() + 60_000) {
      const ret = await prisma.booking.create({
        data: {
          companyId,
          customerName: d.customerName,
          customerPhone: d.customerPhone,
          customerId,
          pickupAddress: d.destAddress,
          pickupLat: d.dest.lat,
          pickupLng: d.dest.lng,
          destAddress: d.pickupAddress,
          destLat: d.pickup.lat,
          destLng: d.pickup.lng,
          vehicleClass,
          medicalType: normalizeMedicalType(d.medicalType),
          ...medicalDetailsData(d),
          institutionId: d.institutionId ?? null,
          notes: d.notes ?? null,
          isScheduled: true,
          scheduledAt: retAt,
          distanceMeters: estimate.distanceMeters,
          durationSeconds: estimate.durationSeconds,
          priceMin,
          priceMax,
          priceApprox,
          tariff: estimate.tariff,
          status: "OFFEN",
          trackingStatus: "GEPLANT",
          paymentMethod: "CASH",
        },
      });
      returnBookingId = ret.id;
    }
  }

  return NextResponse.json({ id: booking.id, returnBookingId, booking: bookingDTO(booking) }, { status: 201 });
}
