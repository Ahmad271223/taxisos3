import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Stornierungs-Historie einer Buchung (Admin-Sicht). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const booking = await prisma.booking.findUnique({ where: { id: params.id } });
  if (!booking) {
    return NextResponse.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
  }
  if (booking.companyId && booking.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 403 });
  }
  const logs = await prisma.cancellationLog.findMany({
    where: { bookingId: params.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ logs });
}
