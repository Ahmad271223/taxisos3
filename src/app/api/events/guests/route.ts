import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

async function ownEvent(eventId: string, hostId: string) {
  const e = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, eventHostId: true } });
  return e && e.eventHostId === hostId ? e : null;
}

export async function GET(req: Request) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const eventId = new URL(req.url).searchParams.get("eventId") ?? "";
  if (!(await ownEvent(eventId, session.sub))) return NextResponse.json({ guests: [] });
  const guests = await prisma.eventGuest.findMany({ where: { eventId }, orderBy: { name: "asc" } });
  return NextResponse.json({ guests });
}

const schema = z.object({
  eventId: z.string().min(1),
  name: z.string().min(1).max(120),
  phone: z.string().max(40).optional().nullable(),
  groupName: z.string().max(80).optional().nullable(),
  hotel: z.string().max(120).optional().nullable(),
  destAddress: z.string().max(200).optional().nullable(),
  isVip: z.boolean().optional(),
  requirements: z.string().max(500).optional().nullable(),
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
  if (!parsed.success) return NextResponse.json({ error: "Bitte Event und Gastname angeben." }, { status: 400 });
  const d = parsed.data;
  if (!(await ownEvent(d.eventId, session.sub))) return NextResponse.json({ error: "Event nicht gefunden" }, { status: 404 });
  const guest = await prisma.eventGuest.create({
    data: {
      eventId: d.eventId, name: d.name, phone: d.phone ?? null, groupName: d.groupName ?? null,
      hotel: d.hotel ?? null, destAddress: d.destAddress ?? null, isVip: d.isVip ?? false, requirements: d.requirements ?? null,
    },
  });
  return NextResponse.json({ guest }, { status: 201 });
}
