import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signSession, authConfigured, HOTEL_COOKIE } from "@/lib/auth";

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

  const hotel = await prisma.hotel.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!hotel || !hotel.active || !(await verifyPassword(parsed.data.password, hotel.passwordHash))) {
    return NextResponse.json({ error: "E-Mail oder Passwort falsch." }, { status: 401 });
  }

  const token = signSession({ sub: hotel.id, role: "HOTEL", name: hotel.name, username: hotel.email, companyId: hotel.id });
  const res = NextResponse.json({ ok: true, id: hotel.id, name: hotel.name });
  res.cookies.set(HOTEL_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
  return res;
}
