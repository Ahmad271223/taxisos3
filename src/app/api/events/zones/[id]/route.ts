import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

async function ownZone(id: string, hostId: string) {
  const zone = await prisma.eventZone.findUnique({ where: { id } });
  if (!zone || zone.eventHostId !== hostId) return null;
  return zone;
}

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  radiusMeters: z.number().int().min(30).max(5000).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await ownZone(params.id, session.sub))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  let json: any;
  try { json = await req.json(); } catch { return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 }); }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
  const zone = await prisma.eventZone.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ zone });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await ownZone(params.id, session.sub))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.eventZone.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
