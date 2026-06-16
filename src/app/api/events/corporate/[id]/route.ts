import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

async function ownCode(id: string, hostId: string) {
  const code = await prisma.corporateCode.findUnique({ where: { id } });
  if (!code || code.eventHostId !== hostId) return null;
  return code;
}

const patchSchema = z.object({
  label: z.string().max(120).nullable().optional(),
  budgetEuro: z.number().min(0).max(1_000_000).nullable().optional(),
  maxRides: z.number().int().min(1).max(100_000).nullable().optional(),
  perRideEuro: z.number().min(0).max(100_000).nullable().optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await ownCode(params.id, session.sub))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  let json: any;
  try { json = await req.json(); } catch { return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 }); }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
  const d = parsed.data;

  // EUR-Felder in Cent übersetzen; null = Limit entfernen, undefined = unverändert.
  const data: Record<string, unknown> = {};
  if (d.label !== undefined) data.label = d.label;
  if (d.maxRides !== undefined) data.maxRides = d.maxRides;
  if (d.active !== undefined) data.active = d.active;
  if (d.validUntil !== undefined) data.validUntil = d.validUntil;
  if (d.budgetEuro !== undefined) data.budgetCents = d.budgetEuro == null ? null : Math.round(d.budgetEuro * 100);
  if (d.perRideEuro !== undefined) data.perRideCents = d.perRideEuro == null ? null : Math.round(d.perRideEuro * 100);

  const code = await prisma.corporateCode.update({ where: { id: params.id }, data });
  return NextResponse.json({ code });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await ownCode(params.id, session.sub))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.corporateCode.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
