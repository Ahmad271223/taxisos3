import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

async function own(id: string, hostId: string) {
  const e = await prisma.event.findUnique({ where: { id } });
  if (!e || e.eventHostId !== hostId) return null;
  return e;
}

const patchSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  contactName: z.string().max(120).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  expectedGuests: z.number().int().min(0).max(100000).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await own(params.id, session.sub))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  const event = await prisma.event.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ event });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await own(params.id, session.sub))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.event.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
