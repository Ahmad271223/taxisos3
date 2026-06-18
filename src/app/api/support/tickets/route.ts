import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Ermittelt den meldenden B2B-Partner aus der jeweiligen Rollen-Session.
function reporter() {
  const hotel = getSession("hotel");
  if (hotel) return { type: "HOTEL", id: hotel.sub, name: hotel.name };
  const event = getSession("event");
  if (event) return { type: "EVENT", id: event.sub, name: event.name };
  const inst = getSession("institution");
  if (inst) return { type: "INSTITUTION", id: inst.sub, name: inst.name };
  return null;
}

const CATEGORIES = ["DRIVER_NO_SHOW", "GUEST_NOT_FOUND", "WRONG_VEHICLE", "WRONG_INVOICE", "BAD_BEHAVIOR", "OTHER"] as const;

export async function GET() {
  const r = reporter();
  if (!r) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const tickets = await prisma.supportTicket.findMany({
    where: { reporterType: r.type, reporterId: r.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ tickets });
}

const schema = z.object({
  category: z.enum(CATEGORIES),
  subject: z.string().min(2).max(160),
  message: z.string().min(2).max(2000),
  bookingId: z.string().max(40).optional().nullable(),
});

export async function POST(req: Request) {
  const r = reporter();
  if (!r) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte Kategorie, Betreff und Beschreibung angeben." }, { status: 400 });
  const d = parsed.data;
  const ticket = await prisma.supportTicket.create({
    data: {
      reporterType: r.type,
      reporterId: r.id,
      reporterName: r.name,
      category: d.category,
      subject: d.subject,
      message: d.message,
      bookingId: d.bookingId || null,
    },
  });
  return NextResponse.json({ ticket }, { status: 201 });
}
