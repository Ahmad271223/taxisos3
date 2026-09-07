import { NextResponse } from "next/server";
import { einrichtungAktiv } from "@/lib/kontoAktiv";
import { alarm } from "@/server/alarm";
import { rateLimit } from "@/lib/ratelimit";
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

const point = z.object({ address: z.string().min(1), lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) });

const schema = z.object({
  patientId: z.string().optional().nullable(),
  // patientName/Details kommen aus medicalDetailsSchema (unten gespreadet).
  patientPhone: z.string().max(40).optional().nullable(),
  pickup: point,
  dest: point,
  vehicleClass: z.string().optional().nullable(),
  medicalType: z.string().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  // Schnellauftrag: sofort an freie Fahrer (AUTO-Disposition). Ohne -> Pool,
  // den die Taxi-Zentralen einem Fahrer zuweisen (ADMIN-Disposition).
  quickOrder: z.boolean().optional(),
  ...medicalDetailsSchema,
});

// Liste der Fahrten dieser Einrichtung.
export async function GET() {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  // Eine Sperre muss SOFORT wirken, nicht erst wenn der Ausweis nach sieben
  // Tagen ablaeuft - hier haengen Patientenakten dran.
  if (!(await einrichtungAktiv(session.sub))) {
    return NextResponse.json(
      { error: "Ihr Zugang ist derzeit gesperrt. Bitte wenden Sie sich an die Zentrale.", code: "INSTITUTION_INACTIVE" },
      { status: 403 },
    );
  }
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
  // Ein einzelnes Konto kann hier viel Last erzeugen (Krankenfahrten). Die Bremse
  // haengt am Konto, nicht an der IP - eine Einrichtung sitzt hinter
  // einem gemeinsamen Anschluss.
  // Ohne Dispatcher wuerde die Fahrt angelegt, aber nie gesucht - der Kunde
  // saehe endlos "Fahrer wird gesucht". Dann lieber ehrlich ablehnen.
  if (!getDispatcher()) {
    return NextResponse.json({ error: "Vermittlung gerade nicht erreichbar. Bitte in einer Minute erneut versuchen." }, { status: 503 });
  }
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  // Eine Sperre muss SOFORT wirken, nicht erst wenn der Ausweis nach sieben
  // Tagen ablaeuft - hier haengen Patientenakten dran.
  if (!(await einrichtungAktiv(session.sub))) {
    return NextResponse.json(
      { error: "Ihr Zugang ist derzeit gesperrt. Bitte wenden Sie sich an die Zentrale.", code: "INSTITUTION_INACTIVE" },
      { status: 403 },
    );
  }
  if (!rateLimit(`inst-ride:${session.sub}`, 60, 60 * 60_000).ok) {
    return NextResponse.json({ error: "Zu viele Aufträge in kurzer Zeit. Bitte kurz warten." }, { status: 429 });
  }
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

  // Schnellauftrag (sofort) -> AUTO an freie Fahrer; sonst Pool für die
  // Taxi-Zentralen (ADMIN). Ein Schnellauftrag ist immer „jetzt".
  const quickOrder = d.quickOrder === true;
  const dispatchMode = quickOrder ? "AUTO" : "ADMIN";
  const scheduledAt = quickOrder ? null : d.scheduledAt ? new Date(d.scheduledAt) : null;
  const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now() + 60_000;
  // AUTO+sofort -> SUCHE (Fahrersuche). Sonst (ADMIN-Pool oder Vorbestellung)
  // wartet die Fahrt als GEPLANT auf die Zuweisung durch eine Zentrale.
  const trackingStatus = quickOrder ? "SUCHE" : "GEPLANT";

  const booking = await prisma.booking.create({
    data: {
      institutionId: inst.id,
      institutionPatientId: patient?.id ?? null,
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
      dispatchMode,
      distanceMeters: est.distanceMeters,
      durationSeconds: est.durationSeconds,
      priceMin: applyClassFactor(est.priceMin, factor),
      priceMax: applyClassFactor(est.priceMax, factor),
      priceApprox: applyClassFactor(approxFare(rate, est.distanceMeters, est.durationSeconds), factor),
      tariff: est.tariff,
      status: "OFFEN",
      trackingStatus,
      paymentMethod: "CASH",
    },
    include: { driver: true },
  });

  // Nur Schnellaufträge (AUTO, sofort) gehen direkt an freie Fahrer. Pool-Fahrten
  // (ADMIN) warten auf die Zuweisung durch eine Taxi-Zentrale.
  if (dispatchMode === "AUTO" && !isScheduled) getDispatcher()
      ?.dispatchBooking(booking.id)
      // Der Fehler wurde frueher stillschweigend verworfen: die Krankenfahrt stand
      // in der Datenbank, aber niemand suchte je einen Fahrer, und die
      // Anfrage meldete trotzdem Erfolg. Jetzt wird der Fehlschlag
      // protokolliert und gemeldet, damit er nicht unbemerkt bleibt.
      .catch((e: any) => {
        console.error(`Vermittlung fehlgeschlagen (${booking.id}):`, e?.message ?? e);
        alarm("warnung", `dispatch:${booking.id}`, "Vermittlung fehlgeschlagen", {
          hinweis: `Krankenfahrt ${booking.id} wurde angelegt, aber die Vermittlung schlug fehl: ${e?.message ?? e}`,
        });
      });
  await logAccess({ actorType: "INSTITUTION", actorId: inst.id, action: "CREATE", entity: "BOOKING", entityId: booking.id, detail: patientName });

  return NextResponse.json({ id: booking.id, ride: bookingDTO(booking) }, { status: 201 });
}
