import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signSession, INSTITUTION_COOKIE } from "@/lib/auth";

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

  const inst = await prisma.institution.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!inst || !inst.active || !(await verifyPassword(parsed.data.password, inst.passwordHash))) {
    return NextResponse.json({ error: "E-Mail oder Passwort falsch." }, { status: 401 });
  }

  const token = signSession({ sub: inst.id, role: "INSTITUTION", name: inst.name, username: inst.email, companyId: inst.id });
  const res = NextResponse.json({ ok: true, id: inst.id, name: inst.name });
  res.cookies.set(INSTITUTION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
  return res;
}
