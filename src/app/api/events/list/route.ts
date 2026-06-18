import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const events = await prisma.event.findMany({
    where: { eventHostId: session.sub },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { guests: true, shuttles: true } } },
  });
  return NextResponse.json({ events });
}

const schema = z.object({
  name: z.string().min(2).max(160),
  contactName: z.string().max(120).optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  location: z.string().max(200).optional().nullable(),
  expectedGuests: z.number().int().min(0).max(100000).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
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
  if (!parsed.success) return NextResponse.json({ error: "Bitte mindestens einen Eventnamen angeben." }, { status: 400 });
  const d = parsed.data;
  const event = await prisma.event.create({
    data: {
      eventHostId: session.sub,
      name: d.name,
      contactName: d.contactName ?? null,
      contactPhone: d.contactPhone ?? null,
      eventDate: d.eventDate ?? null,
      location: d.location ?? null,
      expectedGuests: d.expectedGuests ?? null,
      notes: d.notes ?? null,
    },
  });
  return NextResponse.json({ event }, { status: 201 });
}
