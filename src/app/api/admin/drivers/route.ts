import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import { driverAdmin } from "@/server/serialize";
import { normalizeClass } from "@/lib/vehicleClasses";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const drivers = await prisma.driver.findMany({
    where: { companyId: session.companyId },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ drivers: drivers.map((d) => driverAdmin(d)) });
}

const createSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3),
  password: z.string().min(4),
  phone: z.string().optional().nullable(),
  vehicleModel: z.string().optional().nullable(),
  vehiclePlate: z.string().optional().nullable(),
  vehicleColor: z.string().optional().nullable(),
  vehicleSeats: z.number().int().min(1).max(9).optional(),
  vehicleClass: z.string().optional().nullable(),
  medicalAllowed: z.boolean().optional(),
  hasRamp: z.boolean().optional(),
  hasStretcher: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte Name, Benutzername (min. 3) und Passwort (min. 4) angeben." }, { status: 400 });
  }
  const d = parsed.data;

  if (await prisma.driver.findUnique({ where: { username: d.username } })) {
    return NextResponse.json({ error: "Benutzername ist bereits vergeben." }, { status: 409 });
  }

  const driver = await prisma.driver.create({
    data: {
      companyId: session.companyId,
      name: d.name,
      username: d.username,
      passwordHash: await hashPassword(d.password),
      phone: d.phone ?? null,
      vehicleModel: d.vehicleModel ?? null,
      vehiclePlate: d.vehiclePlate ?? null,
      vehicleColor: d.vehicleColor ?? null,
      vehicleSeats: d.vehicleSeats ?? 4,
      vehicleClass: normalizeClass(d.vehicleClass),
      medicalAllowed: d.medicalAllowed ?? false,
      hasRamp: d.hasRamp ?? false,
      hasStretcher: d.hasStretcher ?? false,
      status: "OFFLINE",
    },
  });
  return NextResponse.json({ driver: driverAdmin(driver) }, { status: 201 });
}
