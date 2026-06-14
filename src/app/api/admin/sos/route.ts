import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// Offene SOS-Meldungen des eigenen Unternehmens (Phase 17).
export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const alerts = await prisma.sosAlert.findMany({
    where: { companyId: session.companyId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ alerts });
}

const schema = z.object({ id: z.string() });

// SOS-Meldung als erledigt markieren.
export async function PATCH(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  const alert = await prisma.sosAlert.findUnique({ where: { id: parsed.data.id } });
  if (!alert || alert.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  await prisma.sosAlert.update({ where: { id: alert.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
