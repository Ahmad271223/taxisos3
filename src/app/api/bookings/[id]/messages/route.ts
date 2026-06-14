import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { messageDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

/** Chat-Verlauf einer Buchung (Phase 3i). Live-Updates kommen via Socket. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const booking = await prisma.booking.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!booking) {
    return NextResponse.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
  }
  const messages = await prisma.chatMessage.findMany({
    where: { bookingId: params.id },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return NextResponse.json({ messages: messages.map(messageDTO) });
}
