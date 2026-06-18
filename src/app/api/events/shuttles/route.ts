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
  if (!(await ownEvent(eventId, session.sub))) return NextResponse.json({ shuttles: [] });
  const shuttles = await prisma.shuttleSlot.findMany({ where: { eventId }, orderBy: { time: "asc" } });
  return NextResponse.json({ shuttles });
}

const schema = z.object({
  eventId: z.string().min(1),
  label: z.string().min(1).max(120),
  fromAddress: z.string().max(200).optional().nullable(),
  toAddress: z.string().max(200).optional().nullable(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  vehicleClass: z.string().max(30).optional().nullable(),
  seats: z.number().int().min(1).max(99).optional().nullable(),
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
  if (!parsed.success) return NextResponse.json({ error: "Bitte Event, Bezeichnung und Uhrzeit (HH:MM) angeben." }, { status: 400 });
  const d = parsed.data;
  if (!(await ownEvent(d.eventId, session.sub))) return NextResponse.json({ error: "Event nicht gefunden" }, { status: 404 });
  const shuttle = await prisma.shuttleSlot.create({
    data: { eventId: d.eventId, label: d.label, fromAddress: d.fromAddress ?? null, toAddress: d.toAddress ?? null, time: d.time, vehicleClass: d.vehicleClass ?? null, seats: d.seats ?? null },
  });
  return NextResponse.json({ shuttle }, { status: 201 });
}
