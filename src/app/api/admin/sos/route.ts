import { NextResponse } from "next/server";
import { logAccess } from "@/lib/accessLog";
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

  // Ein Notruf ist das ernsteste Ereignis im ganzen System. Bisher stand danach
  // nur "irgendwann erledigt" im Datensatz - wer ihn gesehen, bewertet und
  // geschlossen hat, war nicht mehr feststellbar. Fuer die spaetere
  // Aufarbeitung (und fuer die Berufsgenossenschaft) muss das nachvollziehbar
  // sein, deshalb ein eigener Eintrag im Zugriffsprotokoll.
  await logAccess({
    actorType: "ADMIN",
    companyId: session.companyId,
    actorId: session.companyId,
    action: "UPDATE",
    entity: "SOS",
    entityId: alert.id,
    detail: `Notruf geschlossen durch ${session.name ?? session.username ?? session.companyId}`,
  });
  return NextResponse.json({ ok: true });
}
