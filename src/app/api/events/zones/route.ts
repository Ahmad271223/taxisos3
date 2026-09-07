import { NextResponse } from "next/server";
import { portalCan } from "@/lib/portalRoles";

// Unterkonten eines Veranstalters (portalRole) hatten bisher dieselben Rechte
// wie der Inhaber: die Sitzung laeuft aus technischen Gruenden unter der ID
// des Hauptkontos, und geprueft wurde die Rolle nirgends. Eine Kraft mit
// der Rolle "Buchhaltung" konnte damit Rabattcodes anlegen und Fahrten
// buchen. Jetzt entscheidet portalCan() ueber jeden schreibenden Zugriff.
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const zones = await prisma.eventZone.findMany({ where: { eventHostId: session.sub }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ zones });
}

const schema = z.object({
  name: z.string().min(2).max(120),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  radiusMeters: z.number().int().min(30).max(5000).optional(),
});

export async function POST(req: Request) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!portalCan(session.portalRole, "settings")) {
    return NextResponse.json({ error: "Ihre Rolle darf diese Einstellungen nicht ändern." }, { status: 403 });
  }
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte Name und Position angeben." }, { status: 400 });
  const d = parsed.data;
  const zone = await prisma.eventZone.create({
    data: { eventHostId: session.sub, name: d.name, lat: d.lat, lng: d.lng, radiusMeters: d.radiusMeters ?? 300 },
  });
  return NextResponse.json({ zone }, { status: 201 });
}
