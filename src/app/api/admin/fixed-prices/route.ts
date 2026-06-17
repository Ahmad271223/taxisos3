import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { normalizeClass } from "@/lib/vehicleClasses";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const rules = await prisma.fixedPriceRule.findMany({ where: { companyId: session.companyId }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ rules });
}

const schema = z.object({
  name: z.string().min(2).max(120),
  fromLabel: z.string().max(160).optional().nullable(),
  fromLat: z.number(),
  fromLng: z.number(),
  fromRadius: z.number().int().min(100).max(20000).optional(),
  toLabel: z.string().max(160).optional().nullable(),
  toLat: z.number(),
  toLng: z.number(),
  toRadius: z.number().int().min(100).max(20000).optional(),
  price: z.number().min(0).max(100000),
  bidirectional: z.boolean().optional(),
  vehicleClass: z.string().optional().nullable(),
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
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte Start, Ziel und Preis angeben." }, { status: 400 });
  const d = parsed.data;
  // Klasse normalisieren: leer/„ALLE" -> null (gilt für alle Klassen).
  const vehicleClass = d.vehicleClass && d.vehicleClass !== "ALL" ? normalizeClass(d.vehicleClass) : null;
  const rule = await prisma.fixedPriceRule.create({
    data: {
      companyId: session.companyId,
      name: d.name,
      fromLabel: d.fromLabel ?? null,
      fromLat: d.fromLat,
      fromLng: d.fromLng,
      fromRadius: d.fromRadius ?? 1500,
      toLabel: d.toLabel ?? null,
      toLat: d.toLat,
      toLng: d.toLng,
      toRadius: d.toRadius ?? 1500,
      price: d.price,
      bidirectional: d.bidirectional ?? true,
      vehicleClass,
    },
  });
  return NextResponse.json({ rule }, { status: 201 });
}
