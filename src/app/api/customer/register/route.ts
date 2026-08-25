import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, CUSTOMER_COOKIE } from "@/lib/auth";
import { normalizeTarget, phoneVerificationRequired, verifyVerifyToken } from "@/lib/verify";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(3),
  password: z.string().min(6),
  verificationToken: z.string().optional().nullable(),
});

/** Kundenkonto erstellen. Telefon wird (wie bei der Buchung) per SMS verifiziert. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (ip) {
    const r = rateLimit(`register-customer:${ip}`, 10, 10 * 60_000);
    if (!r.ok) return NextResponse.json({ error: "Zu viele Versuche. Bitte später erneut." }, { status: 429 });
  }

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte Name, gültige E-Mail, Telefon und Passwort (min. 6) angeben." }, { status: 400 });
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();

  // Telefon-Verifizierung (wie bei der Buchung), damit das Konto eine bestätigte Nummer hat.
  let telBestaetigt: Date | null = null;
  if (phoneVerificationRequired()) {
    const proof = verifyVerifyToken(d.verificationToken, { channel: "SMS", target: normalizeTarget("SMS", d.phone) });
    if (!proof) {
      return NextResponse.json(
        { error: "Telefonnummer nicht bestätigt. Bitte zuerst den SMS-Code verifizieren.", code: "VERIFICATION_REQUIRED" },
        { status: 403 },
      );
    }
    // Das Feld phoneVerifiedAt wurde bisher NIRGENDS geschrieben – es stand im
    // Schema als "Voraussetzung fuer Buchungen", war aber immer leer und hat
    // damit eine Zusicherung vorgetaeuscht, die es nicht gab.
    telBestaetigt = new Date();
  }

  if (await prisma.customer.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "Diese E-Mail ist bereits registriert." }, { status: 409 });
  }

  const customer = await prisma.customer.create({
    data: {
      name: d.name,
      email,
      phone: d.phone,
      passwordHash: await hashPassword(d.password),
      phoneVerifiedAt: telBestaetigt,
    },
  });

  const token = signSession({ sub: customer.id, role: "CUSTOMER", name: customer.name, username: customer.email, companyId: "", phone: customer.phone });
  const res = NextResponse.json({ ok: true, name: customer.name, email: customer.email });
  res.cookies.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
