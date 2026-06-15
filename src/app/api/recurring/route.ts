import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { normalizeClass } from "@/lib/vehicleClasses";
import { normalizeMedicalType, medicalDetailsSchema, medicalDetailsData } from "@/lib/medical";
import { materializeSeries } from "@/lib/recurring";
import { recurringDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

const point = z.object({ address: z.string().min(1), lat: z.number(), lng: z.number() });
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/);

const schema = z.object({
  pickup: point,
  dest: point,
  vehicleClass: z.string().optional().nullable(),
  medicalType: z.string().optional().nullable(),
  ...medicalDetailsSchema,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  timeOfDay: hhmm,
  returnTrip: z.boolean().optional(),
  returnTimeOfDay: hhmm.optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

// Liste der eigenen Serien (mit nächsten anstehenden Fahrten).
export async function GET() {
  const session = getSession("customer");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const series = await prisma.recurringRide.findMany({
    where: { customerId: session.sub },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  const out = await Promise.all(
    series.map(async (r) => {
      const upcoming = await prisma.booking.findMany({
        where: { recurringId: r.id, status: "OFFEN", scheduledAt: { gt: new Date() } },
        orderBy: { scheduledAt: "asc" },
        take: 5,
      });
      return recurringDTO(r, { upcoming });
    }),
  );
  return NextResponse.json({ recurring: out });
}

// Neue Serie anlegen (Kundenkonto erforderlich) + sofort vorausplanen.
export async function POST(req: Request) {
  const session = getSession("customer");
  if (!session) {
    return NextResponse.json(
      { error: "Für wiederkehrende Fahrten ist ein Kundenkonto nötig. Bitte anmelden.", code: "LOGIN_REQUIRED" },
      { status: 401 },
    );
  }
  const customer = await prisma.customer.findUnique({ where: { id: session.sub } });
  if (!customer) return NextResponse.json({ error: "Konto nicht gefunden" }, { status: 401 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte Strecke, Wochentage und Uhrzeit angeben." }, { status: 400 });
  }
  const d = parsed.data;
  const daysOfWeek = Array.from(new Set(d.daysOfWeek)).sort((a, b) => a - b).join(",");
  const startDate = d.startDate ? new Date(d.startDate) : new Date();
  const endDate = d.endDate ? new Date(d.endDate) : null;

  const series = await prisma.recurringRide.create({
    data: {
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      pickupAddress: d.pickup.address,
      pickupLat: d.pickup.lat,
      pickupLng: d.pickup.lng,
      destAddress: d.dest.address,
      destLat: d.dest.lat,
      destLng: d.dest.lng,
      vehicleClass: normalizeClass(d.vehicleClass ?? "WHEELCHAIR"),
      medicalType: normalizeMedicalType(d.medicalType),
      ...medicalDetailsData(d),
      daysOfWeek,
      timeOfDay: d.timeOfDay,
      returnTrip: d.returnTrip ?? false,
      returnTimeOfDay: d.returnTrip ? d.returnTimeOfDay ?? null : null,
      startDate,
      endDate,
      notes: d.notes ?? null,
    },
  });

  // Sofort die nächsten Tage vorausplanen, damit Fahrten gleich sichtbar sind.
  let created = 0;
  try {
    created = await materializeSeries(series as any, 7);
  } catch {
    /* Materialisierung läuft sonst beim Scheduler-Lauf */
  }

  const upcoming = await prisma.booking.findMany({
    where: { recurringId: series.id, status: "OFFEN", scheduledAt: { gt: new Date() } },
    orderBy: { scheduledAt: "asc" },
    take: 10,
  });
  return NextResponse.json({ id: series.id, created, recurring: recurringDTO(series, { upcoming }) }, { status: 201 });
}
