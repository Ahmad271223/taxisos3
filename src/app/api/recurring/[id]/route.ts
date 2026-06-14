import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { recurringDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

// Serie beenden: deaktivieren + alle noch offenen, künftigen Fahrten stornieren.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = getSession("customer");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const series = await prisma.recurringRide.findUnique({ where: { id: params.id } });
  if (!series || series.customerId !== session.sub) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  await prisma.recurringRide.update({ where: { id: series.id }, data: { active: false } });

  // Künftige, noch nicht disponierte Fahrten der Serie stornieren.
  const future = await prisma.booking.findMany({
    where: { recurringId: series.id, status: "OFFEN", scheduledAt: { gt: new Date() } },
    select: { id: true },
  });
  for (const b of future) {
    await prisma.booking.update({
      where: { id: b.id },
      data: { status: "STORNIERT", trackingStatus: "STORNIERT", cancelledAt: new Date(), cancelledBy: "CUSTOMER" },
    });
    await prisma.cancellationLog.create({ data: { bookingId: b.id, actorType: "CUSTOMER", reason: "Serie beendet" } });
  }

  const updated = await prisma.recurringRide.findUnique({ where: { id: series.id } });
  return NextResponse.json({ ok: true, cancelled: future.length, recurring: recurringDTO(updated) });
}
