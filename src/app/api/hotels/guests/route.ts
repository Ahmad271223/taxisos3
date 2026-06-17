import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const guests = await prisma.hotelGuest.findMany({ where: { hotelId: session.sub }, orderBy: { name: "asc" } });
  return NextResponse.json({ guests });
}

const schema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(40).optional().nullable(),
  roomNumber: z.string().max(20).optional().nullable(),
  language: z.string().max(40).optional().nullable(),
  preferredVehicleClass: z.string().max(30).optional().nullable(),
  defaultDestAddress: z.string().max(200).optional().nullable(),
  defaultDestLat: z.number().optional().nullable(),
  defaultDestLng: z.number().optional().nullable(),
  isVip: z.boolean().optional(),
  notes: z.string().max(500).optional().nullable(),
});

export async function POST(req: Request) {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte mindestens einen Namen angeben." }, { status: 400 });
  const d = parsed.data;
  const guest = await prisma.hotelGuest.create({
    data: {
      hotelId: session.sub,
      name: d.name,
      phone: d.phone ?? null,
      roomNumber: d.roomNumber ?? null,
      language: d.language ?? null,
      preferredVehicleClass: d.preferredVehicleClass ?? null,
      defaultDestAddress: d.defaultDestAddress ?? null,
      defaultDestLat: d.defaultDestLat ?? null,
      defaultDestLng: d.defaultDestLng ?? null,
      isVip: d.isVip ?? false,
      notes: d.notes ?? null,
    },
  });
  return NextResponse.json({ guest }, { status: 201 });
}
