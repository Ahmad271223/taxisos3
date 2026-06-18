import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import { portalCan, PORTAL_ROLES } from "@/lib/portalRoles";

export const dynamic = "force-dynamic";

// Ermittelt Parent (Hotel/Event) + Rolle aus der jeweiligen Portal-Session.
function portalParent() {
  const hotel = getSession("hotel");
  if (hotel) return { type: "HOTEL", id: hotel.sub, role: hotel.portalRole };
  const event = getSession("event");
  if (event) return { type: "EVENT", id: event.sub, role: event.portalRole };
  return null;
}

export async function GET() {
  const p = portalParent();
  if (!p) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!portalCan(p.role, "manageUsers")) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  const users = await prisma.portalUser.findMany({
    where: { parentType: p.type, parentId: p.id },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ users });
}

const ROLE_KEYS = PORTAL_ROLES.map((r) => r.key) as [string, ...string[]];
const schema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(ROLE_KEYS),
});

export async function POST(req: Request) {
  const p = portalParent();
  if (!p) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!portalCan(p.role, "manageUsers")) return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte Name, E-Mail, Passwort (min. 6) und Rolle angeben." }, { status: 400 });
  const d = parsed.data;
  const email = d.email.toLowerCase();
  if (await prisma.portalUser.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "Diese E-Mail ist bereits vergeben." }, { status: 409 });
  }
  const user = await prisma.portalUser.create({
    data: { parentType: p.type, parentId: p.id, name: d.name, email, passwordHash: await hashPassword(d.password), role: d.role },
    select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
  });
  return NextResponse.json({ user }, { status: 201 });
}
