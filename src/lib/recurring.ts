// Wiederkehrende Krankenfahrten (Phase 15): aus einer Serie (Wochentage + Uhrzeit)
// werden im Voraus geplante Buchungen erzeugt. Wird beim Anlegen und periodisch
// vom Scheduler aufgerufen. Dedupliziert über recurringId + scheduledAt.

import { prisma } from "@/lib/prisma";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug, classFactorForSlug, applyClassFactor } from "@/lib/pricing";
import { getPlatformRate, approxFare } from "@/lib/platformRate";
import { normalizeClass } from "@/lib/vehicleClasses";

type Series = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destAddress: string;
  destLat: number;
  destLng: number;
  vehicleClass: string;
  medicalType: string | null;
  // Krankenfahrt-Details (Phase B) + Anforderungen (Phase D) + Einrichtung (Phase E).
  patientName?: string | null;
  patientBirthDate?: string | null;
  mobility?: string | null;
  companions?: number | null;
  medicalEquipment?: string | null;
  payerType?: string | null;
  insuranceName?: string | null;
  insuranceNumber?: string | null;
  requiresRamp?: boolean | null;
  requiresStretcher?: boolean | null;
  institutionId?: string | null;
  daysOfWeek: string;
  timeOfDay: string;
  returnTrip: boolean;
  returnTimeOfDay: string | null;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
  notes: string | null;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function atTime(day: Date, hhmm: string): Date {
  const [h, m] = (hhmm || "00:00").split(":").map((n) => parseInt(n, 10));
  const d = new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function parseDays(csv: string): Set<number> {
  return new Set(
    (csv || "")
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n) && n >= 0 && n <= 6),
  );
}

async function priceFor(from: { lat: number; lng: number }, to: { lat: number; lng: number }, vehicleClass: string) {
  const pricing = await pricingForSlug(undefined);
  const est = await estimatePriceViaWith([from, to], pricing);
  const factor = await classFactorForSlug(undefined, vehicleClass);
  const rate = await getPlatformRate();
  return {
    distanceMeters: est.distanceMeters,
    durationSeconds: est.durationSeconds,
    tariff: est.tariff,
    priceMin: applyClassFactor(est.priceMin, factor),
    priceMax: applyClassFactor(est.priceMax, factor),
    priceApprox: applyClassFactor(approxFare(rate, est.distanceMeters, est.durationSeconds), factor),
  };
}

async function ensureBooking(series: Series, scheduledAt: Date, outbound: boolean, price: any): Promise<boolean> {
  const existing = await prisma.booking.findFirst({ where: { recurringId: series.id, scheduledAt } });
  if (existing) return false;
  await prisma.booking.create({
    data: {
      recurringId: series.id,
      customerId: series.customerId,
      customerName: series.customerName,
      customerPhone: series.customerPhone,
      pickupAddress: outbound ? series.pickupAddress : series.destAddress,
      pickupLat: outbound ? series.pickupLat : series.destLat,
      pickupLng: outbound ? series.pickupLng : series.destLng,
      destAddress: outbound ? series.destAddress : series.pickupAddress,
      destLat: outbound ? series.destLat : series.pickupLat,
      destLng: outbound ? series.destLng : series.pickupLng,
      vehicleClass: normalizeClass(series.vehicleClass),
      medicalType: series.medicalType,
      // Krankenfahrt-Details/Anforderungen aus der Serie übernehmen (Phase B/D/E).
      patientName: series.patientName ?? null,
      patientBirthDate: series.patientBirthDate ?? null,
      mobility: series.mobility ?? null,
      companions: series.companions ?? 0,
      medicalEquipment: series.medicalEquipment ?? null,
      payerType: series.payerType ?? null,
      insuranceName: series.insuranceName ?? null,
      insuranceNumber: series.insuranceNumber ?? null,
      requiresRamp: series.requiresRamp ?? false,
      requiresStretcher: series.requiresStretcher ?? false,
      institutionId: series.institutionId ?? null,
      isScheduled: true,
      scheduledAt,
      distanceMeters: price.distanceMeters,
      durationSeconds: price.durationSeconds,
      tariff: price.tariff,
      priceMin: price.priceMin,
      priceMax: price.priceMax,
      priceApprox: price.priceApprox,
      status: "OFFEN",
      trackingStatus: "GEPLANT",
      paymentMethod: "CASH",
      paymentStatus: "OFFEN",
    },
  });
  return true;
}

// Erzeugt fehlende Buchungen einer Serie für die nächsten `lookaheadDays` Tage.
export async function materializeSeries(series: Series, lookaheadDays = 3): Promise<number> {
  if (!series.active) return 0;
  const days = parseDays(series.daysOfWeek);
  if (days.size === 0) return 0;

  const now = new Date();
  const out = await priceFor(
    { lat: series.pickupLat, lng: series.pickupLng },
    { lat: series.destLat, lng: series.destLng },
    series.vehicleClass,
  );
  const ret = series.returnTrip
    ? await priceFor(
        { lat: series.destLat, lng: series.destLng },
        { lat: series.pickupLat, lng: series.pickupLng },
        series.vehicleClass,
      )
    : null;

  const startBound = startOfDay(series.startDate);
  const endBound = series.endDate ? startOfDay(series.endDate) : null;

  let created = 0;
  const base = startOfDay(now);
  for (let off = 0; off <= lookaheadDays; off++) {
    const day = new Date(base);
    day.setDate(day.getDate() + off);
    if (!days.has(day.getDay())) continue;
    if (day < startBound) continue;
    if (endBound && day > endBound) continue;

    const outAt = atTime(day, series.timeOfDay);
    if (outAt.getTime() > now.getTime() + 60_000) {
      if (await ensureBooking(series, outAt, true, out)) created++;
    }
    if (series.returnTrip && series.returnTimeOfDay && ret) {
      const retAt = atTime(day, series.returnTimeOfDay);
      if (retAt.getTime() > now.getTime() + 60_000) {
        if (await ensureBooking(series, retAt, false, ret)) created++;
      }
    }
  }
  return created;
}

// Für ALLE aktiven, nicht abgelaufenen Serien Buchungen vorausplanen.
export async function materializeDueRides(lookaheadDays = 3): Promise<number> {
  const today = startOfDay(new Date());
  const all = await prisma.recurringRide.findMany({
    where: { active: true, OR: [{ endDate: null }, { endDate: { gte: today } }] },
  });
  let total = 0;
  for (const s of all) {
    try {
      total += await materializeSeries(s as unknown as Series, lookaheadDays);
    } catch {
      /* eine Serie darf den Lauf nicht stoppen */
    }
  }
  return total;
}
