import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, authConfigured, EVENT_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte alle Pflichtfelder ausfüllen (Passwort min. 6 Zeichen)." }, { status: 400 });
  if (!authConfigured()) return NextResponse.json({ error: "Server nicht vollständig konfiguriert (AUTH_SECRET)." }, { status: 500 });
  const d = parsed.data;
  const email = d.email.toLowerCase();

  if (await prisma.eventHost.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "Diese E-Mail ist bereits registriert." }, { status: 409 });
  }

  const { host, token } = await prisma.$transaction(async (tx) => {
    const host = await tx.eventHost.create({ data: { name: d.name, email, passwordHash: await hashPassword(d.password), phone: d.phone ?? null } });
    const token = signSession({ sub: host.id, role: "EVENT", name: host.name, username: host.email, companyId: host.id });
    return { host, token };
  });

  const res = NextResponse.json({ ok: true, id: host.id, name: host.name }, { status: 201 });
  res.cookies.set(EVENT_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
  return res;
}
