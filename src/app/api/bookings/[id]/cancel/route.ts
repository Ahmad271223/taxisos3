import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getDispatcher } from "@/server/runtime";
import { getSession } from "@/lib/session";
import { bookingRefWhereCustomer } from "@/lib/bookingRef";

export const dynamic = "force-dynamic";

const schema = z.object({
  reason: z.string().max(500).optional().nullable(),
});

/**
 * Kunden-Stornierung. Erlaubt, solange der Fahrer noch nicht angekommen ist
 * (trackingStatus in {SUCHE, RESERVIERT_FAHRER, FAHRER_GEFUNDEN, FAHRER_UNTERWEGS, GEPLANT}).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const booking = await prisma.booking.findFirst({ where: bookingRefWhereCustomer(params.id, getSession("customer")?.sub) });
  if (!booking) {
    return NextResponse.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
  }
  if (booking.status === "ABGESCHLOSSEN" || booking.status === "STORNIERT") {
    return NextResponse.json({ error: "Diese Fahrt kann nicht mehr storniert werden." }, { status: 409 });
  }
  const blocked = ["FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT", "BEENDET"];
  if (blocked.includes(booking.trackingStatus)) {
    return NextResponse.json(
      { error: "Stornierung nicht mehr möglich – der Fahrer ist bereits am Abholort." },
      { status: 409 },
    );
  }

  let reason: string | null = null;
  try {
    const json = await req.json();
    const parsed = schema.safeParse(json);
    reason = parsed.success ? parsed.data.reason ?? null : null;
  } catch {
    /* body optional */
  }

  await getDispatcher()?.cancelBooking(booking.id, { actorType: "CUSTOMER", reason: reason ?? undefined });
  const updated = await prisma.booking.findUnique({
    where: { id: booking.id },
    include: { driver: true },
  });
  return NextResponse.json({ ok: true, booking: updated });
}
