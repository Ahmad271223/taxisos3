import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { normalizeClass } from "@/lib/vehicleClasses";
import { normalizeMedicalType, medicalDetailsSchema, medicalDetailsData } from "@/lib/medical";
import { materializeSeries } from "@/lib/recurring";
import { recurringDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

const point = z.object({ address: z.string().min(1), lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) });
// Vorher bestand auch "99:99" diese Pruefung. Spaeter landet der Wert in
// setHours(); JavaScript rechnet 99:99 klaglos in ein voellig anderes Datum um -
// die Fahrt entsteht dann irgendwann, nur nicht wann gewuenscht.
const hhmm = z
  .string()
  .regex(/^(?:[01]?\d|2[0-3]):[0-5]\d$/, "Bitte eine Uhrzeit zwischen 00:00 und 23:59 angeben.");

// Datumsangaben mussten bisher gar nichts sein: aus "morgen" wurde ein
// ungueltiges Datum, aus dem nie eine Fahrt entstand.
const isoDatum = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, "Bitte ein Datum im Format JJJJ-MM-TT angeben.")
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "Ungültiges Datum.");

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
  startDate: isoDatum.optional().nullable(),
  endDate: isoDatum.optional().nullable(),
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

  // "Mit Rueckfahrt" ohne Rueckfahrzeit hat die Serie klaglos gespeichert - die
  // Rueckfahrt entstand dann NIE, weil die Erzeugung beide Angaben verlangt.
  // Bei einer Dialysefahrt heisst das: der Patient kommt nicht nach Hause.
  if (d.returnTrip && !d.returnTimeOfDay) {
    return NextResponse.json(
      { error: "Bitte auch eine Uhrzeit für die Rückfahrt angeben." },
      { status: 400 },
    );
  }
  if (endDate && endDate.getTime() < startDate.getTime()) {
    return NextResponse.json({ error: "Das Enddatum liegt vor dem Startdatum." }, { status: 400 });
  }

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
      // Fehlt die Angabe, war die Serie bisher automatisch eine
      // Rollstuhlfahrt - ein Fehler im Formular machte aus jeder Serie eine
      // Spezialfahrt mit anderem Preis und anderem Fahrerkreis.
      vehicleClass: normalizeClass(d.vehicleClass ?? "STANDARD"),
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
