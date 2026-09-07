import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { messageDTO } from "@/server/serialize";
import { getSession } from "@/lib/session";
import { bookingRefWhereCustomer } from "@/lib/bookingRef";

export const dynamic = "force-dynamic";

/** Chat-Verlauf einer Buchung (Phase 3i). Live-Updates kommen via Socket. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const booking = await prisma.booking.findFirst({ where: bookingRefWhereCustomer(params.id, getSession("customer")?.sub), select: { id: true } });
  if (!booking) {
    return NextResponse.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
  }
  const messages = await prisma.chatMessage.findMany({
    where: { bookingId: booking.id },
    // Die NEUESTEN 100, danach fuer die Anzeige wieder aufsteigend. Vorher
    // kamen die aeltesten 100 - ab der 101. Nachricht verschwand alles Neue.
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  messages.reverse();
  // Die kanonische Auftrags-ID mitgeben: der Aufrufer kennt oft nur den
  // Verfolgungs-Token aus der Adresszeile, die Ereignisse des Servers nennen
  // aber immer die ID. Ohne diesen Wert kann die Oberflaeche eingehende
  // Nachrichten nicht zuordnen und verwirft sie.
  return NextResponse.json({ bookingId: booking.id, messages: messages.map(messageDTO) });
}
