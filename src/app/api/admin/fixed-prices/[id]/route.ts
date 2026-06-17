import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

async function own(id: string, companyId: string) {
  const rule = await prisma.fixedPriceRule.findUnique({ where: { id } });
  if (!rule || rule.companyId !== companyId) return null;
  return rule;
}

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  fromRadius: z.number().int().min(100).max(20000).optional(),
  toRadius: z.number().int().min(100).max(20000).optional(),
  price: z.number().min(0).max(100000).optional(),
  bidirectional: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await own(params.id, session.companyId))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
  const rule = await prisma.fixedPriceRule.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ rule });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await own(params.id, session.companyId))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.fixedPriceRule.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
