import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { bookingDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

// Live-Dispo: alle Fahrten einer Veranstaltung (für die Echtzeit-Tafel).
export async function GET(req: Request) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const eventId = new URL(req.url).searchParams.get("eventId") ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, eventHostId: true } });
  if (!event || event.eventHostId !== session.sub) return NextResponse.json({ rides: [] });
  const rides = await prisma.booking.findMany({
    where: { eventId },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: 300,
    include: { driver: true },
  });
  return NextResponse.json({ rides: rides.map((b) => bookingDTO(b)) });
}
