import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let pricing = await prisma.pricing.findUnique({ where: { companyId: session.companyId } });
  if (!pricing) {
    pricing = await prisma.pricing.create({ data: { companyId: session.companyId } });
  }
  return NextResponse.json({ pricing });
}

const schema = z.object({
  basePrice: z.number().min(0).max(100),
  perKmDay: z.number().min(0).max(100),
  perKmNight: z.number().min(0).max(100),
  perKmWeekend: z.number().min(0).max(100),
  perMinute: z.number().min(0).max(100).optional(),
  nightStartHour: z.number().int().min(0).max(23).optional(),
  nightEndHour: z.number().int().min(0).max(23).optional(),
});

export async function PUT(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Preisdaten" }, { status: 400 });
  }
  const pricing = await prisma.pricing.upsert({
    where: { companyId: session.companyId },
    update: parsed.data,
    create: { companyId: session.companyId, ...parsed.data },
  });
  return NextResponse.json({ pricing });
}
