import { NextResponse } from "next/server";
import { portalCan } from "@/lib/portalRoles";

// Unterkonten eines Veranstalters (portalRole) hatten bisher dieselben Rechte
// wie der Inhaber: die Sitzung laeuft aus technischen Gruenden unter der ID
// des Hauptkontos, und geprueft wurde die Rolle nirgends. Eine Kraft mit
// der Rolle "Buchhaltung" konnte damit Rabattcodes anlegen und Fahrten
// buchen. Jetzt entscheidet portalCan() ueber jeden schreibenden Zugriff.
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!portalCan(session.portalRole, "settings")) {
    return NextResponse.json({ error: "Ihre Rolle darf diese Einstellungen nicht ändern." }, { status: 403 });
  }
  const s = await prisma.shuttleSlot.findUnique({ where: { id: params.id }, include: { event: { select: { eventHostId: true } } } });
  if (!s || s.event.eventHostId !== session.sub) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.shuttleSlot.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
