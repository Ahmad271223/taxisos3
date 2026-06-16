import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// Eigentums-Check: gehört der Promo-Code dem eingeloggten Veranstalter?
async function ownPromo(id: string, hostId: string) {
  const promo = await prisma.promoCode.findUnique({ where: { id } });
  if (!promo || promo.eventHostId !== hostId) return null;
  return promo;
}

const patchSchema = z.object({
  label: z.string().max(120).nullable().optional(),
  discountType: z.enum(["PERCENT", "FIXED"]).optional(),
  discountValue: z.number().min(0).max(100000).optional(),
  validUntil: z.string().max(20).nullable().optional(),
  maxUses: z.number().int().min(1).max(1000000).nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await ownPromo(params.id, session.sub))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  let json: any;
  try { json = await req.json(); } catch { return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 }); }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
  const d = parsed.data;
  if (d.discountType === "PERCENT" && d.discountValue != null && d.discountValue > 100) {
    return NextResponse.json({ error: "Prozentrabatt max. 100." }, { status: 400 });
  }
  const promo = await prisma.promoCode.update({ where: { id: params.id }, data: d });
  return NextResponse.json({ promo });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await ownPromo(params.id, session.sub))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.promoCode.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
