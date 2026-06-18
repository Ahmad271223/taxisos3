import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const s = await prisma.shuttleSlot.findUnique({ where: { id: params.id }, include: { event: { select: { eventHostId: true } } } });
  if (!s || s.event.eventHostId !== session.sub) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.shuttleSlot.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
