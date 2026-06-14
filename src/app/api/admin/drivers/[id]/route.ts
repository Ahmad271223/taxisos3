import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { driverAdmin } from "@/server/serialize";
import { normalizeClass } from "@/lib/vehicleClasses";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  vehicleModel: z.string().optional().nullable(),
  vehiclePlate: z.string().optional().nullable(),
  vehicleColor: z.string().optional().nullable(),
  vehicleSeats: z.number().int().min(1).max(9).optional(),
  vehicleClass: z.string().optional().nullable(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  // Mandantencheck: Fahrer muss zur eigenen Firma gehoeren.
  const existing = await prisma.driver.findUnique({ where: { id: params.id } });
  if (!existing || existing.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  }
  const data = { ...parsed.data };
  if (data.vehicleClass != null) data.vehicleClass = normalizeClass(data.vehicleClass);
  const driver = await prisma.driver.update({ where: { id: params.id }, data });
  return NextResponse.json({ driver: driverAdmin(driver) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const existing = await prisma.driver.findUnique({ where: { id: params.id } });
  if (!existing || existing.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  // Aktive Auftraege blockieren das Loeschen.
  const activeCount = await prisma.booking.count({
    where: { driverId: existing.id, status: { in: ["ZUGEWIESEN", "AKTIV"] } },
  });
  if (activeCount > 0) {
    return NextResponse.json(
      { error: "Fahrer hat noch laufende Aufträge. Bitte zuerst abschließen oder stornieren." },
      { status: 409 },
    );
  }
  // Historie behalten – nur Verknuepfung zum Fahrer aufloesen.
  await prisma.booking.updateMany({
    where: { driverId: existing.id },
    data: { driverId: null },
  });
  await prisma.driver.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}

// Detail-Endpunkt fuer "Fahrer auf Karte anklicken".
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const driver = await prisma.driver.findUnique({ where: { id: params.id } });
  if (!driver || driver.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  const [activeBooking, agg, recent] = await Promise.all([
    prisma.booking.findFirst({
      where: { driverId: driver.id, status: { in: ["ZUGEWIESEN", "AKTIV"] } },
    }),
    prisma.booking.aggregate({
      where: { driverId: driver.id, rating: { not: null } },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.booking.findMany({
      where: { driverId: driver.id, status: "ABGESCHLOSSEN" },
      orderBy: { completedAt: "desc" },
      take: 5,
      select: { id: true, completedAt: true, fare: true, rating: true, pickupAddress: true, destAddress: true },
    }),
  ]);
  return NextResponse.json({
    driver: driverAdmin(driver),
    activeBooking,
    ratings: { avg: agg._avg.rating ?? null, count: agg._count.rating ?? 0 },
    recent,
  });
}
