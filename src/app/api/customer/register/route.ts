import { NextResponse } from "next/server";
import { anlegenOderKollision } from "@/lib/eindeutig";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, CUSTOMER_COOKIE } from "@/lib/auth";
import { normalizeTarget, phoneVerificationRequired, verifyVerifyToken } from "@/lib/verify";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(3).max(40),
  password: z.string().min(8).max(200),
  verificationToken: z.string().optional().nullable(),
});

/** Kundenkonto erstellen. Telefon wird (wie bei der Buchung) per SMS verifiziert. */
export async function POST(req: Request) {
  // Auch ohne erkennbare Adresse bremsen - sonst laeuft die Registrierung in
  // genau dem Fall ungebremst, in dem man den Absender nicht zuordnen kann.
  const ip = clientIp(req);
  const bremse = ip
    ? rateLimit(`register-customer:${ip}`, 5, 10 * 60_000)
    : rateLimit("register-customer:ohne-adresse", 100, 10 * 60_000);
  if (!bremse.ok) {
    return NextResponse.json({ error: "Zu viele Registrierungen. Bitte später erneut." }, { status: 429 });
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

  // Die Pruefung oben ist nicht atomar: zwei gleichzeitige Anmeldungen sehen
  // beide "frei". Die Datenbank faengt das ab - bisher aber als ungefangener
  // Fehler und damit als Serverfehler beim Nutzer.
  const passwortHash = await hashPassword(d.password);
  const angelegt = await anlegenOderKollision(() =>
    prisma.customer.create({
      data: {
        name: d.name,
        email,
        phone: d.phone,
        passwordHash: passwortHash,
        phoneVerifiedAt: telBestaetigt,
      },
    }),
  );
  if (!angelegt.ok) {
    return NextResponse.json({ error: "Diese E-Mail ist bereits registriert." }, { status: 409 });
  }
  const customer = angelegt.wert;

  const token = signSession({ sub: customer.id, role: "CUSTOMER", name: customer.name, username: customer.email, companyId: "", phone: customer.phone });
  const res = NextResponse.json({ ok: true, name: customer.name, email: customer.email });
  res.cookies.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Genau so lange wie der Ausweis selbst gilt (7 Tage). Vorher blieb das
      // Merkmal 30 Tage liegen, obwohl es nach 7 Tagen wertlos war - der
      // Nutzer sah sich angemeldet und bekam von jeder Abfrage ein Nein.
      maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
