import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { groupDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

// Status einer Gruppen-/Eventbuchung: Eltern-Datensatz + alle Fahrzeuge.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const group = await prisma.bookingGroup.findUnique({ where: { id: params.id } });
  if (!group) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const bookings = await prisma.booking.findMany({
    where: { groupId: group.id },
    include: { driver: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ group: groupDTO(group, bookings) });
}
