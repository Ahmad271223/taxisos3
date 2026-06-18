import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { medicalLabel } from "@/lib/medical";
import { vehicleClass as vehicleClassInfo } from "@/lib/vehicleClasses";
import { getDispatcher } from "@/server/runtime";
import { logAccess } from "@/lib/accessLog";

export const dynamic = "force-dynamic";

// Zuweisungs-Pool: offene Krankenfahrten/Vorbestellungen (dispatchMode ADMIN),
// die noch keiner Zentrale zugewiesen sind. Sichtbar für ALLE Taxi-Zentralen –
// die erste, die einen Fahrer zuweist, bekommt die Fahrt.
export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const rows = await prisma.booking.findMany({
    where: { dispatchMode: "ADMIN", status: "OFFEN", driverId: null },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: 100,
    include: { institution: { select: { name: true, type: true } } },
  });

  // Schlanke, datensparsame Pool-Ansicht (keine Versicherungs-/Kostenträgerdaten).
  const pool = rows.map((b) => ({
    id: b.id,
    patientName: b.patientName ?? b.customerName,
    institution: b.institution?.name ?? "Einrichtung",
    institutionType: b.institution?.type ?? null,
    medicalType: b.medicalType ?? null,
    medicalLabel: medicalLabel(b.medicalType),
    vehicleClass: b.vehicleClass,
    vehicleClassLabel: vehicleClassInfo(b.vehicleClass).label,
    vehicleClassIcon: vehicleClassInfo(b.vehicleClass).icon,
    requiresRamp: b.requiresRamp ?? false,
    requiresStretcher: b.requiresStretcher ?? false,
    pickupAddress: b.pickupAddress,
    destAddress: b.destAddress,
    scheduledAt: b.scheduledAt ? b.scheduledAt.toISOString() : null,
    isScheduled: b.isScheduled,
    distanceMeters: b.distanceMeters ?? null,
    createdAt: b.createdAt.toISOString(),
  }));
  return NextResponse.json({ pool });
}

const assignSchema = z.object({ bookingId: z.string(), driverId: z.string() });

// Pool-Fahrt einem eigenen Fahrer zuweisen (Annahme der Vorbestellung).
export async function POST(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try { json = await req.json(); } catch { return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 }); }
  const parsed = assignSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "bookingId und driverId erforderlich." }, { status: 400 });

  // Fahrer muss zur eigenen Zentrale gehören.
  const driver = await prisma.driver.findUnique({ where: { id: parsed.data.driverId }, select: { id: true, companyId: true, name: true } });
  if (!driver || driver.companyId !== session.companyId) {
    return NextResponse.json({ error: "Fahrer gehört nicht zu Ihrer Zentrale." }, { status: 403 });
  }

  const dispatcher = getDispatcher();
  if (!dispatcher) return NextResponse.json({ error: "Dispositionsdienst nicht verfügbar." }, { status: 503 });
  const res = await dispatcher.assignFromPool(parsed.data.bookingId, driver.id, session.companyId);
  if (!res.ok) return NextResponse.json({ error: res.reason ?? "Zuweisung fehlgeschlagen." }, { status: 409 });

  await logAccess({ actorType: "ADMIN", actorId: session.companyId, action: "UPDATE", entity: "BOOKING", entityId: parsed.data.bookingId, detail: `Pool-Fahrt zugewiesen an ${driver.name}` });
  return NextResponse.json({ ok: true });
}
