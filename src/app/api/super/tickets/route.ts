import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// Alle Support-Tickets (Super-Admin). Optional nach Status filterbar.
export async function GET(req: Request) {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const status = new URL(req.url).searchParams.get("status");
  const where = status && ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"].includes(status) ? { status } : {};
  const tickets = await prisma.supportTicket.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
  const openCount = await prisma.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } });
  return NextResponse.json({ tickets, openCount });
}
