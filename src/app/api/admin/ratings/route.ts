import { NextResponse } from "next/server";
import { logAccess } from "@/lib/accessLog";
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

  const limit = Math.min(100, Math.max(10, parseInt(searchParams.get("limit") ?? "100", 10) || 100));
  const cursor = searchParams.get("cursor") || null;

  const ratings = await prisma.booking.findMany({
    where,
    orderBy: { ratedAt: "desc" },
    // Blaettern statt harter Deckel: ab dem 101. Eintrag war vorher nichts
    // mehr auffindbar.
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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

  const weitere = ratings.length > limit;
  const seite = weitere ? ratings.slice(0, limit) : ratings;

  // Dieser Abruf enthaelt Fahrgastnamen sowie genaue Start- und Zieladressen.
  // Wie bei den anderen Auswertungen mit Personenbezug wird der Zugriff
  // protokolliert.
  await logAccess({
    actorType: "ADMIN",
    companyId: session.role === "SUPER_ADMIN" ? undefined : session.companyId,
    actorId: session.sub,
    action: "VIEW",
    entity: "BOOKING",
    detail: `Bewertungen abgerufen (${seite.length} Eintraege)`,
  });

  return NextResponse.json({
    ratings: seite,
    byDriver: grouped,
    nextCursor: weitere ? seite[seite.length - 1]?.id ?? null : null,
  });
}
