import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const promos = await prisma.promoCode.findMany({ where: { eventHostId: session.sub }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ promos });
}

const schema = z.object({
  code: z.string().min(3).max(30),
  label: z.string().max(120).optional().nullable(),
  discountType: z.enum(["PERCENT", "FIXED"]),
  discountValue: z.number().min(0).max(100000),
  validUntil: z.string().max(20).optional().nullable(),
  maxUses: z.number().int().min(1).max(1000000).optional().nullable(),
});

export async function POST(req: Request) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte Code, Typ und Wert angeben." }, { status: 400 });
  const d = parsed.data;
  const code = d.code.toUpperCase().replace(/\s+/g, "");
  if (d.discountType === "PERCENT" && d.discountValue > 100) {
    return NextResponse.json({ error: "Prozentrabatt max. 100." }, { status: 400 });
  }

  if (await prisma.promoCode.findUnique({ where: { code } })) {
    return NextResponse.json({ error: "Dieser Code ist bereits vergeben." }, { status: 409 });
  }

  const promo = await prisma.promoCode.create({
    data: {
      eventHostId: session.sub,
      code,
      label: d.label ?? null,
      discountType: d.discountType,
      discountValue: d.discountValue,
      validUntil: d.validUntil ?? null,
      maxUses: d.maxUses ?? null,
    },
  });
  return NextResponse.json({ promo }, { status: 201 });
}
