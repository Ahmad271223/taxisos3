import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signSession, authConfigured, EVENT_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "E-Mail und Passwort erforderlich." }, { status: 400 });
  if (!authConfigured()) return NextResponse.json({ error: "Server nicht vollständig konfiguriert (AUTH_SECRET)." }, { status: 500 });

  const email = parsed.data.email.toLowerCase();
  const host = await prisma.eventHost.findUnique({ where: { email } });
  let parentId: string | null = null;
  let displayName = "";
  let portalRole: string | undefined;
  if (host && host.active && (await verifyPassword(parsed.data.password, host.passwordHash))) {
    parentId = host.id;
    displayName = host.name;
  } else {
    const pu = await prisma.portalUser.findUnique({ where: { email } });
    if (pu && pu.active && pu.parentType === "EVENT" && (await verifyPassword(parsed.data.password, pu.passwordHash))) {
      parentId = pu.parentId;
      displayName = pu.name;
      portalRole = pu.role;
    }
  }
  if (!parentId) {
    return NextResponse.json({ error: "E-Mail oder Passwort falsch." }, { status: 401 });
  }

  const token = signSession({ sub: parentId, role: "EVENT", name: displayName, username: email, companyId: parentId, portalRole });
  const res = NextResponse.json({ ok: true, id: parentId, name: displayName });
  res.cookies.set(EVENT_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
  return res;
}
