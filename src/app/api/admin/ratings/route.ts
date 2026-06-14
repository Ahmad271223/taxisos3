import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Listet Bewertungen aller Fahrten der eingeloggten Firma.
 * Sichtbar nur fuer ADMIN (Firma) und SUPER_ADMIN. Fahrer sehen ihre eigene
 * Statistik separat ueber /api/driver/summary; andere Fahrer haben keinen
 * Zugriff auf Bewertungen.
 */
export async function GET(req: Request) {
  const session = requireRole("ADMIN") || requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const driverId = searchParams.get("driverId");

  const where: any = {
    rating: { not: null },
  };
  // SUPER_ADMIN sieht alle Firmen; ADMIN nur die eigene.
  if (session.role !== "SUPER_ADMIN") {
    where.companyId = session.companyId;
  }
  if (driverId) where.driverId = driverId;

  const ratings = await prisma.booking.findMany({
    where,
    orderBy: { ratedAt: "desc" },
    take: 100,
    select: {
      id: true,
      rating: true,
      ratedAt: true,
      ratingComment: true,
      customerName: true,
      pickupAddress: true,
      destAddress: true,
      fare: true,
      driver: { select: { id: true, name: true, vehiclePlate: true } },
      company: session.role === "SUPER_ADMIN" ? { select: { id: true, name: true, slug: true } } : false,
    },
  });

  // Aggregat pro Fahrer
  const grouped = await prisma.booking.groupBy({
    by: ["driverId"],
    where: { ...where, driverId: { not: null } },
    _avg: { rating: true },
    _count: { rating: true },
  });

  return NextResponse.json({ ratings, byDriver: grouped });
}
