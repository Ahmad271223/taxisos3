import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ host: null }, { status: 401 });
  const host = await prisma.eventHost.findUnique({ where: { id: session.sub }, select: { id: true, name: true, email: true } });
  if (!host) return NextResponse.json({ host: null }, { status: 401 });
  return NextResponse.json({ host });
}
