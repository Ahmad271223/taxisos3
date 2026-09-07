import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";
import { einrichtungVergessen } from "@/lib/kontoAktiv";

export const dynamic = "force-dynamic";

// Freigabe von Einrichtungen (Kliniken, Pflegeheime, Dialyse, Reha).
//
// Hintergrund: Die Registrierung unter /api/institutions/register ist
// oeffentlich - jeder kann behaupten, ein Dialysezentrum zu sein. Ein solches
// Konto darf anschliessend Patientendaten anlegen und Krankenfahrten
// ausloesen. Im Echtbetrieb entsteht es deshalb gesperrt und wird hier
// freigeschaltet, nachdem jemand die Einrichtung tatsaechlich geprueft hat
// (Anruf unter der veroeffentlichten Nummer, Impressum, Traegerschaft).

export async function GET(req: Request) {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const nurOffene = new URL(req.url).searchParams.get("pending") === "1";
  const institutions = await prisma.institution.findMany({
    where: nurOffene ? { active: false } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      type: true,
      email: true,
      phone: true,
      address: true,
      active: true,
      createdAt: true,
      _count: { select: { patients: true, bookings: true } },
    },
  });
  const pendingCount = await prisma.institution.count({ where: { active: false } });
  return NextResponse.json({ institutions, pendingCount });
}

const schema = z.object({ id: z.string().min(1), active: z.boolean() });

export async function PATCH(req: Request) {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "id und active erforderlich." }, { status: 400 });

  const inst = await prisma.institution.findUnique({ where: { id: parsed.data.id }, select: { id: true, name: true } });
  if (!inst) return NextResponse.json({ error: "Einrichtung nicht gefunden" }, { status: 404 });

  await prisma.institution.update({ where: { id: inst.id }, data: { active: parsed.data.active } });
  // Damit die Aenderung sofort wirkt und nicht erst nach Ablauf des
  // Zwischenspeichers in kontoAktiv.ts.
  einrichtungVergessen(inst.id);

  // Eine Freigabe entscheidet darueber, wer Gesundheitsdaten anlegen darf -
  // sie muss nachvollziehbar sein.
  await logAccess({
    actorType: "ADMIN",
    actorId: session.sub,
    action: "UPDATE",
    entity: "INSTITUTION",
    entityId: inst.id,
    detail: `${parsed.data.active ? "Freigegeben" : "Gesperrt"}: ${inst.name}`,
  });

  return NextResponse.json({ ok: true, id: inst.id, active: parsed.data.active });
}
