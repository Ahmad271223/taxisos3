import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Plattform-weite Statistik fuer den Super-Admin. */
export async function GET() {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const [companies, drivers, bookings, ratings, completed, platformAgg, cancelled30d] = await Promise.all([
    prisma.company.findMany({
      where: { slug: { not: "_super" } },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { drivers: true, bookings: true } },
      },
    }),
    prisma.driver.count(),
    prisma.booking.count(),
    prisma.booking.count({ where: { rating: { not: null } } }),
    prisma.booking.count({ where: { status: "ABGESCHLOSSEN" } }),
    prisma.booking.aggregate({
      _sum: { fare: true, platformFee: true, companyNet: true },
      where: { status: "ABGESCHLOSSEN" },
    }),
    prisma.booking.count({
      where: {
        status: "STORNIERT",
        cancelledAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
      },
    }),
  ]);

  // Avg-Rating + Plattform-Provision pro Firma
  const [avgPerCompany, finPerCompany] = await Promise.all([
    prisma.booking.groupBy({
      by: ["companyId"],
      where: { rating: { not: null } },
      _avg: { rating: true },
    }),
    prisma.booking.groupBy({
      by: ["companyId"],
      where: { status: "ABGESCHLOSSEN" },
      _sum: { fare: true, platformFee: true, companyNet: true },
      _count: { _all: true },
    }),
  ]);
  const avgMap = new Map(avgPerCompany.map((a) => [a.companyId, a._avg.rating ?? null]));
  const finMap = new Map(finPerCompany.map((a) => [a.companyId, a]));

  return NextResponse.json({
    totals: {
      companies: companies.length,
      drivers,
      bookings,
      ratings,
      completedTrips: completed,
      cancellations30d: cancelled30d,
      grossRevenue: Math.round((platformAgg._sum.fare ?? 0) * 100) / 100,
      platformFee: Math.round((platformAgg._sum.platformFee ?? 0) * 100) / 100,
      companyNet: Math.round((platformAgg._sum.companyNet ?? 0) * 100) / 100,
    },
    companies: companies.map((c) => {
      const f = finMap.get(c.id);
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        email: c.email,
        address: c.address,
        phone: c.phone,
        cityTier: c.cityTier,
        commissionRate: c.cityTier === "BIG" ? 0.07 : 0.05,
        createdAt: c.createdAt,
        drivers: c._count.drivers,
        bookings: c._count.bookings,
        completedTrips: f?._count?._all ?? 0,
        grossRevenue: Math.round((f?._sum?.fare ?? 0) * 100) / 100,
        platformFee: Math.round((f?._sum?.platformFee ?? 0) * 100) / 100,
        companyNet: Math.round((f?._sum?.companyNet ?? 0) * 100) / 100,
        avgRating: avgMap.get(c.id) ?? null,
      };
    }),
  });
}
