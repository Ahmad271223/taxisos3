import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ hotel: null }, { status: 401 });
  const hotel = await prisma.hotel.findUnique({
    where: { id: session.sub },
    select: { id: true, name: true, email: true, phone: true, address: true },
  });
  if (!hotel) return NextResponse.json({ hotel: null }, { status: 401 });
  return NextResponse.json({ hotel });
}
