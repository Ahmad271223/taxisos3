import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { messageDTO } from "@/server/serialize";
import { bookingRefWhere } from "@/lib/bookingRef";

export const dynamic = "force-dynamic";

/** Chat-Verlauf einer Buchung (Phase 3i). Live-Updates kommen via Socket. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const booking = await prisma.booking.findFirst({ where: bookingRefWhere(params.id), select: { id: true } });
  if (!booking) {
    return NextResponse.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
  }
  const messages = await prisma.chatMessage.findMany({
    where: { bookingId: booking.id },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return NextResponse.json({ messages: messages.map(messageDTO) });
}
