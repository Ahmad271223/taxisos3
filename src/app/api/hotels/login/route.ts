import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signSession, authConfigured, HOTEL_COOKIE } from "@/lib/auth";

import { rateLimit, clientIp } from "@/lib/ratelimit";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  // Bruteforce-Schutz wie bei /api/auth/login. Das Limit pro Konto greift
  // IMMER – auch ohne feststellbare IP, sonst liesse es sich durch
  // Unkenntlichmachen der Herkunft aushebeln.
  const koerper = await req.clone().json().catch(() => ({}));
  const kennung = String(koerper?.email ?? "").toLowerCase().slice(0, 120);
  if (kennung) {
    const proKonto = rateLimit(`login-hotels:id:${kennung}`, 20, 5 * 60_000);
    if (!proKonto.ok) {
      return NextResponse.json({ error: "Zu viele Anmeldeversuche. Bitte später erneut." }, { status: 429 });
    }
  }
  const ip = clientIp(req);
  if (ip) {
    const proIp = rateLimit(`login-hotels:ip:${ip}`, 20, 5 * 60_000);
    if (!proIp.ok) {
      return NextResponse.json({ error: "Zu viele Anmeldeversuche. Bitte später erneut." }, { status: 429 });
    }
  }
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
  const hotel = await prisma.hotel.findUnique({ where: { email } });
  let parentId: string | null = null;
  let displayName = "";
  let portalRole: string | undefined;
  if (hotel && hotel.active && (await verifyPassword(parsed.data.password, hotel.passwordHash))) {
    parentId = hotel.id;
    displayName = hotel.name;
  } else {
    // Sub-Nutzer (Rezeption/Buchhaltung ...) – Session läuft auf das Hotel (Parent).
    const pu = await prisma.portalUser.findUnique({ where: { email } });
    if (pu && pu.active && pu.parentType === "HOTEL" && (await verifyPassword(parsed.data.password, pu.passwordHash))) {
      parentId = pu.parentId;
      displayName = pu.name;
      portalRole = pu.role;
    }
  }
  if (!parentId) {
    return NextResponse.json({ error: "E-Mail oder Passwort falsch." }, { status: 401 });
  }

  const token = signSession({ sub: parentId, role: "HOTEL", name: displayName, username: email, companyId: parentId, portalRole });
  const res = NextResponse.json({ ok: true, id: parentId, name: displayName });
  res.cookies.set(HOTEL_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
  return res;
}
