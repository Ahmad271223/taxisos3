import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

async function own(id: string, hotelId: string) {
  const g = await prisma.hotelGuest.findUnique({ where: { id } });
  if (!g || g.hotelId !== hotelId) return null;
  return g;
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).nullable().optional(),
  roomNumber: z.string().max(20).nullable().optional(),
  language: z.string().max(40).nullable().optional(),
  preferredVehicleClass: z.string().max(30).nullable().optional(),
  defaultDestAddress: z.string().max(200).nullable().optional(),
  defaultDestLat: z.number().nullable().optional(),
  defaultDestLng: z.number().nullable().optional(),
  isVip: z.boolean().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("HOTEL");
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
  const guest = await prisma.hotelGuest.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ guest });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!(await own(params.id, session.sub))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.hotelGuest.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
