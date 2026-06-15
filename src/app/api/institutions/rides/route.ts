import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug, classFactorForSlug, applyClassFactor } from "@/lib/pricing";
import { getPlatformRate, approxFare } from "@/lib/platformRate";
import { normalizeClass } from "@/lib/vehicleClasses";
import { normalizeMedicalType, medicalDetailsSchema, medicalDetailsData } from "@/lib/medical";
import { logAccess } from "@/lib/accessLog";
import { getDispatcher } from "@/server/runtime";
import { bookingDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

const point = z.object({ address: z.string().min(1), lat: z.number(), lng: z.number() });

const schema = z.object({
  patientId: z.string().optional().nullable(),
  patientName: z.string().max(120).optional().nullable(),
  patientPhone: z.string().max(40).optional().nullable(),
  pickup: point,
  dest: point,
  vehicleClass: z.string().optional().nullable(),
  medicalType: z.string().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  ...medicalDetailsSchema,
});

// Liste der Fahrten dieser Einrichtung.
export async function GET() {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const bookings = await prisma.booking.findMany({
    where: { institutionId: session.sub },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { driver: true },
  });
  return NextResponse.json({ rides: bookings.map((b) => bookingDTO(b)) });
}

// Neue Krankenfahrt im Auftrag eines Patienten anlegen (Einrichtung ist
// vertrauenswürdig -> keine SMS-Verifizierung) und sofort disponieren.
export async function POST(req: Request) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const inst = await prisma.institution.findUnique({ where: { id: session.sub } });
  if (!inst) return NextResponse.json({ error: "Einrichtung nicht gefunden" }, { status: 401 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte Strecke und Patient angeben." }, { status: 400 });
  const d = parsed.data;

  // Patient auflösen (Stammpatient) oder Inline-Daten.
  let patient: any = null;
  if (d.patientId) {
    patient = await prisma.institutionPatient.findUnique({ where: { id: d.patientId } });
    if (!patient || patient.institutionId !== inst.id) {
      return NextResponse.json({ error: "Patient nicht gefunden" }, { status: 404 });
    }
  }
  const patientName = (patient?.name ?? d.patientName ?? "").trim();
  if (!patientName) return NextResponse.json({ error: "Patientenname fehlt." }, { status: 400 });
  const patientPhone = (patient?.phone ?? d.patientPhone ?? inst.phone ?? "").trim() || "—";

  const vehicleClass = normalizeClass(d.vehicleClass ?? "WHEELCHAIR");
  const details = medicalDetailsData({
    ...d,
    mobility: d.mobility ?? patient?.mobility ?? null,
    payerType: d.payerType ?? patient?.payerType ?? null,
    insuranceName: d.insuranceName ?? patient?.insuranceName ?? null,
    insuranceNumber: d.insuranceNumber ?? patient?.insuranceNumber ?? null,
  });

  // Preisschätzung (wie öffentliche Buchung, Plattform-Tarif).
  const pricing = await pricingForSlug(undefined);
  const est = await estimatePriceViaWith([{ lat: d.pickup.lat, lng: d.pickup.lng }, { lat: d.dest.lat, lng: d.dest.lng }], pricing);
  const factor = await classFactorForSlug(undefined, vehicleClass);
  const rate = await getPlatformRate();

  const scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
  const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now() + 60_000;

  const booking = await prisma.booking.create({
    data: {
      institutionId: inst.id,
      customerName: patientName,
      customerPhone: patientPhone,
      patientName,
      patientBirthDate: patient?.birthDate ?? d.patientBirthDate ?? null,
      pickupAddress: d.pickup.address,
      pickupLat: d.pickup.lat,
      pickupLng: d.pickup.lng,
      destAddress: d.dest.address,
      destLat: d.dest.lat,
      destLng: d.dest.lng,
      vehicleClass,
      medicalType: normalizeMedicalType(d.medicalType),
      mobility: details.mobility,
      companions: details.companions,
      medicalEquipment: details.medicalEquipment,
      payerType: details.payerType,
      insuranceName: details.insuranceName,
      insuranceNumber: details.insuranceNumber,
      requiresRamp: details.requiresRamp,
      requiresStretcher: details.requiresStretcher,
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
  await logAccess({ actorType: "INSTITUTION", actorId: inst.id, action: "CREATE", entity: "BOOKING", entityId: booking.id, detail: patientName });

  return NextResponse.json({ id: booking.id, ride: bookingDTO(booking) }, { status: 201 });
}
