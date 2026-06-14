import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { bookingDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

/** Buchungshistorie des eingeloggten Kunden. */
export async function GET() {
  const session = requireRole("CUSTOMER");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const customer = await prisma.customer.findUnique({ where: { id: session.sub } });
  const bookings = await prisma.booking.findMany({
    where: { customerId: session.sub },
    include: { driver: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    customer: customer ? { name: customer.name, email: customer.email, phone: customer.phone } : null,
    bookings: bookings.map((b) => bookingDTO(b)),
  });
}
