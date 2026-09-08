import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { bookingDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

/** Buchungshistorie des eingeloggten Kunden. */
export async function GET(req: Request) {
  const session = requireRole("CUSTOMER");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(10, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));
  const cursor = url.searchParams.get("cursor") || null;

  const customer = await prisma.customer.findUnique({ where: { id: session.sub } });
  const bookings = await prisma.booking.findMany({
    where: { customerId: session.sub },
    include: { driver: true },
    orderBy: { createdAt: "desc" },
    // Blaettern statt harter Deckel: ab dem 101. Eintrag war vorher nichts
    // mehr auffindbar.
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const weitere = bookings.length > limit;
  const seite = weitere ? bookings.slice(0, limit) : bookings;
  return NextResponse.json({
    customer: customer ? { name: customer.name, email: customer.email, phone: customer.phone } : null,
    bookings: seite.map((b) => bookingDTO(b)),
    nextCursor: weitere ? seite[seite.length - 1]?.id ?? null : null,
  });
}
