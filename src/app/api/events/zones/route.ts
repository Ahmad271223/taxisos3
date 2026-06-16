import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const zones = await prisma.eventZone.findMany({ where: { eventHostId: session.sub }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ zones });
}

const schema = z.object({
  name: z.string().min(2).max(120),
  lat: z.number(),
  lng: z.number(),
  radiusMeters: z.number().int().min(30).max(5000).optional(),
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
  if (!parsed.success) return NextResponse.json({ error: "Bitte Name und Position angeben." }, { status: 400 });
  const d = parsed.data;
  const zone = await prisma.eventZone.create({
    data: { eventHostId: session.sub, name: d.name, lat: d.lat, lng: d.lng, radiusMeters: d.radiusMeters ?? 300 },
  });
  return NextResponse.json({ zone }, { status: 201 });
}
