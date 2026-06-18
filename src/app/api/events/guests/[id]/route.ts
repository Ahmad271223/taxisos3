import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const g = await prisma.eventGuest.findUnique({ where: { id: params.id }, include: { event: { select: { eventHostId: true } } } });
  if (!g || g.event.eventHostId !== session.sub) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.eventGuest.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
