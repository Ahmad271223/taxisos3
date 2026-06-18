import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug, classFactorForSlug, applyClassFactor } from "@/lib/pricing";
import { getPlatformRate, approxFare } from "@/lib/platformRate";
import { normalizeClass } from "@/lib/vehicleClasses";
import { normalizeMedicalType } from "@/lib/medical";
import { logAccess } from "@/lib/accessLog";
import { getDispatcher } from "@/server/runtime";
import { bookingDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

const point = z.object({ address: z.string().min(1), lat: z.number(), lng: z.number() });
const schema = z.object({
  pickup: point.optional(),
  dest: point.optional(),
  medicalType: z.string().optional().nullable(),
  vehicleClass: z.string().optional().nullable(),
  requiresRamp: z.boolean().optional(),
  requiresStretcher: z.boolean().optional(),
  patientName: z.string().max(120).optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
});

// Eine Fahrt ist nur änderbar/stornierbar, solange sie noch nicht losgefahren ist.
const ACTIVE_TRACK = new Set(["FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT", "BEENDET"]);
function notEditable(b: { status: string; trackingStatus: string }): boolean {
  return ["ABGESCHLOSSEN", "STORNIERT"].includes(b.status) || ACTIVE_TRACK.has(b.trackingStatus);
}

async function ownedBooking(bookingId: string, instId: string) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!b || b.institutionId !== instId) return null;
  return b;
}

// Krankenfahrt nachträglich ändern (Zeit, Strecke, Art, Fahrzeug, Hilfsmittel).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const b = await ownedBooking(params.id, session.sub);
  if (!b) return NextResponse.json({ error: "Fahrt nicht gefunden" }, { status: 404 });
  if (notEditable(b)) return NextResponse.json({ error: "Fahrt ist bereits unterwegs oder abgeschlossen – keine Änderung möglich." }, { status: 409 });

  let json: any;
  try { json = await req.json(); } catch { return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 }); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten." }, { status: 400 });
  const d = parsed.data;

  const data: any = {};
  if (d.medicalType !== undefined) data.medicalType = normalizeMedicalType(d.medicalType);
  if (d.requiresRamp !== undefined) data.requiresRamp = d.requiresRamp;
  if (d.requiresStretcher !== undefined) data.requiresStretcher = d.requiresStretcher;
  if (d.patientName != null && d.patientName.trim()) { data.patientName = d.patientName.trim(); data.customerName = d.patientName.trim(); }

  const vehicleClass = d.vehicleClass != null ? normalizeClass(d.vehicleClass) : b.vehicleClass;
  if (d.vehicleClass != null) data.vehicleClass = vehicleClass;

  // Strecke geändert -> Adressen + Preis neu berechnen.
  const pickup = d.pickup ?? { address: b.pickupAddress, lat: b.pickupLat, lng: b.pickupLng };
  const dest = d.dest ?? { address: b.destAddress, lat: b.destLat, lng: b.destLng };
  const routeChanged = !!d.pickup || !!d.dest || d.vehicleClass != null;
  if (d.pickup) { data.pickupAddress = d.pickup.address; data.pickupLat = d.pickup.lat; data.pickupLng = d.pickup.lng; }
  if (d.dest) { data.destAddress = d.dest.address; data.destLat = d.dest.lat; data.destLng = d.dest.lng; }
  if (routeChanged) {
    const pricing = await pricingForSlug(undefined);
    const est = await estimatePriceViaWith([{ lat: pickup.lat, lng: pickup.lng }, { lat: dest.lat, lng: dest.lng }], pricing);
    const factor = await classFactorForSlug(undefined, vehicleClass);
    const rate = await getPlatformRate();
    data.distanceMeters = est.distanceMeters;
    data.durationSeconds = est.durationSeconds;
    data.priceMin = applyClassFactor(est.priceMin, factor);
    data.priceMax = applyClassFactor(est.priceMax, factor);
    data.priceApprox = applyClassFactor(approxFare(rate, est.distanceMeters, est.durationSeconds), factor);
    data.tariff = est.tariff;
  }

  // Zeitpunkt geändert -> Vorbestellung/Sofort neu einstufen (nur solange offen).
  // ADMIN-Pool-Fahrten bleiben immer GEPLANT (Zuweisung durch eine Zentrale) und
  // werden nie automatisch an Fahrer ausgespielt – nur AUTO-Fahrten dispatchen.
  let becameImmediate = false;
  if (d.scheduledAt !== undefined && b.status === "OFFEN") {
    const scheduledAt = d.scheduledAt ? new Date(d.scheduledAt) : null;
    const isScheduled = !!scheduledAt && scheduledAt.getTime() > Date.now() + 60_000;
    data.scheduledAt = scheduledAt;
    data.isScheduled = isScheduled;
    if (b.dispatchMode === "AUTO") {
      if (!isScheduled && b.trackingStatus === "GEPLANT") { data.trackingStatus = "SUCHE"; becameImmediate = true; }
      if (isScheduled && b.trackingStatus !== "GEPLANT") data.trackingStatus = "GEPLANT";
    }
  }

  const updated = await prisma.booking.update({ where: { id: b.id }, data, include: { driver: true } });
  await logAccess({ actorType: "INSTITUTION", actorId: session.sub, action: "UPDATE", entity: "BOOKING", entityId: b.id, detail: "Fahrt geändert" });

  // Aus GEPLANT->Sofort: Disposition starten. Sonst nur DTO broadcasten.
  const dispatcher = getDispatcher();
  if (becameImmediate) dispatcher?.dispatchBooking(b.id).catch(() => {});
  else dispatcher?.refreshBooking(b.id).catch(() => {});

  return NextResponse.json({ ride: bookingDTO(updated) });
}

// Krankenfahrt stornieren (vor Fahrtbeginn).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const b = await ownedBooking(params.id, session.sub);
  if (!b) return NextResponse.json({ error: "Fahrt nicht gefunden" }, { status: 404 });
  if (notEditable(b)) return NextResponse.json({ error: "Fahrt ist bereits unterwegs oder abgeschlossen – keine Stornierung möglich." }, { status: 409 });

  const dispatcher = getDispatcher();
  if (dispatcher) {
    await dispatcher.cancelBooking(b.id, { actorType: "SYSTEM", reason: "Storniert durch Einrichtung" }).catch(async () => {
      await prisma.booking.update({ where: { id: b.id }, data: { status: "STORNIERT", trackingStatus: "STORNIERT" } }).catch(() => {});
    });
  } else {
    await prisma.booking.update({ where: { id: b.id }, data: { status: "STORNIERT", trackingStatus: "STORNIERT" } });
  }
  await logAccess({ actorType: "INSTITUTION", actorId: session.sub, action: "CANCEL", entity: "BOOKING", entityId: b.id, detail: "Fahrt storniert" });
  return NextResponse.json({ ok: true });
}
