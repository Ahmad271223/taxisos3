import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { portalCan, PORTAL_ROLES } from "@/lib/portalRoles";

export const dynamic = "force-dynamic";

function portalParent() {
  const hotel = getSession("hotel");
  if (hotel) return { type: "HOTEL", id: hotel.sub, role: hotel.portalRole };
  const event = getSession("event");
  if (event) return { type: "EVENT", id: event.sub, role: event.portalRole };
  return null;
}

async function own(id: string, type: string, parentId: string) {
  const u = await prisma.portalUser.findUnique({ where: { id } });
  if (!u || u.parentType !== type || u.parentId !== parentId) return null;
  return u;
}

const ROLE_KEYS = PORTAL_ROLES.map((r) => r.key) as [string, ...string[]];
const patchSchema = z.object({ role: z.enum(ROLE_KEYS).optional(), active: z.boolean().optional() });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const p = portalParent();
  if (!p) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!portalCan(p.role, "manageUsers")) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  if (!(await own(params.id, p.type, p.id))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  const user = await prisma.portalUser.update({ where: { id: params.id }, data: parsed.data, select: { id: true, name: true, email: true, role: true, active: true } });
  return NextResponse.json({ user });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const p = portalParent();
  if (!p) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!portalCan(p.role, "manageUsers")) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  if (!(await own(params.id, p.type, p.id))) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await prisma.portalUser.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
