import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { vehicleClass as vehicleClassInfo } from "@/lib/vehicleClasses";

export const dynamic = "force-dynamic";

// Lieblingsfahrer des Kunden (Phase 18).
export async function GET() {
  const session = getSession("customer");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const favs = await prisma.favorite.findMany({
    where: { customerId: session.sub, driverId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  const driverIds = favs.map((f) => f.driverId!).filter(Boolean);
  const drivers = await prisma.driver.findMany({
    where: { id: { in: driverIds } },
    include: { company: { select: { name: true } } },
  });
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const out = favs
    .map((f) => {
      const d = byId.get(f.driverId!);
      if (!d) return null;
      const c = vehicleClassInfo(d.vehicleClass);
      return {
        id: f.id,
        driverId: d.id,
        name: d.name,
        vehicleModel: d.vehicleModel ?? null,
        vehiclePlate: d.vehiclePlate ?? null,
        vehicleClass: c.key,
        vehicleClassLabel: c.label,
        vehicleClassIcon: c.icon,
        company: d.company?.name ?? null,
      };
    })
    .filter(Boolean);
  return NextResponse.json({ favorites: out });
}

const schema = z.object({ driverId: z.string() });

// Fahrer favorisieren.
export async function POST(req: Request) {
  const session = getSession("customer");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "driverId erforderlich" }, { status: 400 });

  const driver = await prisma.driver.findUnique({ where: { id: parsed.data.driverId } });
  if (!driver) return NextResponse.json({ error: "Fahrer nicht gefunden" }, { status: 404 });

  const fav = await prisma.favorite.upsert({
    where: { customerId_driverId: { customerId: session.sub, driverId: driver.id } },
    update: {},
    create: { customerId: session.sub, driverId: driver.id },
  });
  return NextResponse.json({ ok: true, id: fav.id }, { status: 201 });
}

// Favorit entfernen (?driverId=...).
export async function DELETE(req: Request) {
  const session = getSession("customer");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const driverId = new URL(req.url).searchParams.get("driverId");
  if (!driverId) return NextResponse.json({ error: "driverId erforderlich" }, { status: 400 });
  await prisma.favorite
    .delete({ where: { customerId_driverId: { customerId: session.sub, driverId } } })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
