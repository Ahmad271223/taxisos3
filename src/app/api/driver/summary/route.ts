import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { bookingDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("DRIVER");
  if (!session) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todays = await prisma.booking.findMany({
    where: { driverId: session.sub, status: "ABGESCHLOSSEN", completedAt: { gte: startOfDay } },
    select: { fare: true },
  });
  const recent = await prisma.booking.findMany({
    where: { driverId: session.sub, status: "ABGESCHLOSSEN" },
    orderBy: { completedAt: "desc" },
    take: 5,
    include: { driver: true },
  });

  return NextResponse.json({
    today: {
      trips: todays.length,
      revenue: Math.round(todays.reduce((s, b) => s + (b.fare ?? 0), 0) * 100) / 100,
    },
    recent: recent.map((b) => bookingDTO(b)),
  });
}
