import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  const companyId = session.companyId;

  const drivers = await prisma.driver.findMany({ where: { companyId } });
  const byStatus = { FREI: 0, BESETZT: 0, RESERVIERT: 0, PAUSE: 0, OFFLINE: 0 } as Record<string, number>;
  for (const d of drivers) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;

  const activeBookings = await prisma.booking.count({
    where: { companyId, status: { in: ["OFFEN", "ZUGEWIESEN", "AKTIV"] } },
  });
  const scheduledCount = await prisma.booking.count({
    where: { companyId, isScheduled: true, status: { notIn: ["ABGESCHLOSSEN", "STORNIERT"] } },
  });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [todays, month, cancelled30d, company] = await Promise.all([
    prisma.booking.findMany({
      where: { companyId, status: "ABGESCHLOSSEN", completedAt: { gte: startOfDay } },
      select: { fare: true, platformFee: true, companyNet: true },
    }),
    prisma.booking.findMany({
      where: { companyId, status: "ABGESCHLOSSEN", completedAt: { gte: startOfMonth } },
      select: { fare: true, platformFee: true, companyNet: true },
    }),
    prisma.booking.count({
      where: {
        companyId,
        status: "STORNIERT",
        cancelledAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
      },
    }),
    prisma.company.findUnique({ where: { id: companyId } }),
  ]);

  function sums(rows: { fare: number | null; platformFee: number | null; companyNet: number | null }[]) {
    const fare = rows.reduce((s, r) => s + (r.fare ?? 0), 0);
    const fee = rows.reduce((s, r) => s + (r.platformFee ?? 0), 0);
    const net = rows.reduce((s, r) => s + (r.companyNet ?? 0), 0);
    return {
      trips: rows.length,
      revenue: Math.round(fare * 100) / 100,
      platformFee: Math.round(fee * 100) / 100,
      net: Math.round(net * 100) / 100,
      avgFare: rows.length > 0 ? Math.round((fare / rows.length) * 100) / 100 : 0,
    };
  }

  return NextResponse.json({
    company: company
      ? { name: company.name, slug: company.slug, cityTier: company.cityTier }
      : null,
    drivers: {
      total: drivers.length,
      active: drivers.length - (byStatus.OFFLINE ?? 0),
      frei: byStatus.FREI ?? 0,
      besetzt: byStatus.BESETZT ?? 0,
      reserviert: byStatus.RESERVIERT ?? 0,
      pause: byStatus.PAUSE ?? 0,
      offline: byStatus.OFFLINE ?? 0,
    },
    activeBookings,
    scheduledCount,
    today: sums(todays),
    month: sums(month),
    cancellations30d: cancelled30d,
  });
}
