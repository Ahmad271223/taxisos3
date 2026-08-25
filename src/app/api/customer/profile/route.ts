import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { CUSTOMER_COOKIE, signSession, verifyPassword } from "@/lib/auth";
import { normalizeTarget, phoneVerificationRequired, verifyVerifyToken } from "@/lib/verify";

export const dynamic = "force-dynamic";

// Kundenprofil inkl. Punkte/Bonus (Phase 18) + Notfallkontakt (Phase 17).
//
// Seit 2026-08-25 lassen sich hier auch Name, E-Mail und Telefonnummer aendern.
// Vorher ging das gar nicht – das Recht auf Berichtigung (Art. 16 DSGVO) war
// nur ueber einen Eingriff in der Datenbank erfuellbar.

function profilDTO(c: any) {
  return {
    name: c.name,
    email: c.email,
    phone: c.phone,
    points: c.points,
    phoneVerified: !!c.phoneVerifiedAt,
    emergencyContactName: c.emergencyContactName ?? null,
    emergencyContactPhone: c.emergencyContactPhone ?? null,
  };
}

export async function GET() {
  const session = getSession("customer");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const c = await prisma.customer.findUnique({ where: { id: session.sub } });
  if (!c) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ profile: profilDTO(c) });
}

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().max(160).optional(),
  phone: z.string().trim().min(3).max(40).optional(),
  // Nur noetig, wenn E-Mail oder Telefonnummer geaendert werden.
  currentPassword: z.string().optional(),
  // Nachweis fuer eine NEUE Telefonnummer (wie bei der Registrierung).
  verificationToken: z.string().optional(),
  emergencyContactName: z.string().max(120).optional().nullable(),
  emergencyContactPhone: z.string().max(40).optional().nullable(),
});

export async function PATCH(req: Request) {
  const session = getSession("customer");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  const d = parsed.data;

  const c = await prisma.customer.findUnique({ where: { id: session.sub } });
  if (!c) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const neueMail = d.email !== undefined ? d.email.toLowerCase().trim() : undefined;
  const mailAendert = neueMail !== undefined && neueMail !== c.email;
  const telAendert = d.phone !== undefined && d.phone !== c.phone;

  // E-Mail IST die Anmeldekennung, und ueber die Telefonnummer laufen
  // Bestaetigungen. Beides darf nicht allein mit einer offenen Sitzung
  // umgeschrieben werden – ein fremder Zugriff auf ein unbeaufsichtigtes
  // Geraet koennte sonst das Konto uebernehmen.
  if (mailAendert || telAendert) {
    if (!d.currentPassword) {
      return NextResponse.json(
        { error: "Bitte das aktuelle Passwort angeben.", code: "PASSWORT_ERFORDERLICH" },
        { status: 403 },
      );
    }
    if (!(await verifyPassword(d.currentPassword, c.passwordHash))) {
      return NextResponse.json({ error: "Passwort stimmt nicht." }, { status: 403 });
    }
  }

  if (mailAendert) {
    const belegt = await prisma.customer.findUnique({ where: { email: neueMail! }, select: { id: true } });
    if (belegt && belegt.id !== c.id) {
      return NextResponse.json({ error: "Diese E-Mail ist bereits vergeben." }, { status: 409 });
    }
  }

  // Neue Nummer muss genauso bestaetigt werden wie bei der Registrierung.
  // Ohne diese Pruefung liesse sich die Telefon-Verifizierung vollstaendig
  // umgehen: mit bestaetigter Nummer registrieren, danach auf eine beliebige
  // andere wechseln.
  let telBestaetigt: Date | null | undefined;
  if (telAendert) {
    if (phoneVerificationRequired()) {
      const proof = verifyVerifyToken(d.verificationToken, {
        channel: "SMS",
        target: normalizeTarget("SMS", d.phone!),
      });
      if (!proof) {
        return NextResponse.json(
          { error: "Neue Telefonnummer nicht bestätigt. Bitte zuerst den SMS-Code verifizieren.", code: "VERIFICATION_REQUIRED" },
          { status: 403 },
        );
      }
      telBestaetigt = new Date();
    } else {
      // Ohne Pflicht zur Verifizierung gilt die neue Nummer als unbestaetigt.
      // Den alten Bestaetigungsstempel mitzunehmen waere schlicht falsch.
      telBestaetigt = null;
    }
  }

  // Echte Teilaenderung: nur was mitgeschickt wurde, wird angefasst. Frueher
  // setzte diese Route den Notfallkontakt bei jedem Aufruf zurueck.
  const daten: Record<string, unknown> = {};
  if (d.name !== undefined) daten.name = d.name;
  if (mailAendert) daten.email = neueMail;
  if (telAendert) {
    daten.phone = d.phone;
    daten.phoneVerifiedAt = telBestaetigt ?? null;
  }
  if (d.emergencyContactName !== undefined) daten.emergencyContactName = d.emergencyContactName || null;
  if (d.emergencyContactPhone !== undefined) daten.emergencyContactPhone = d.emergencyContactPhone || null;

  if (Object.keys(daten).length === 0) {
    return NextResponse.json({ profile: profilDTO(c) });
  }

  const neu = await prisma.customer.update({ where: { id: c.id }, data: daten });

  const res = NextResponse.json({ profile: profilDTO(neu) });

  // Sitzung neu ausstellen: Name, Kennung und Rufnummer stecken im Cookie und
  // waeren sonst veraltet – die Oberflaeche zeigte weiter die alten Werte.
  if (daten.name || daten.email || daten.phone) {
    const token = signSession({
      sub: neu.id,
      role: "CUSTOMER",
      name: neu.name,
      username: neu.email,
      companyId: "",
      phone: neu.phone,
    });
    res.cookies.set(CUSTOMER_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      secure: process.env.NODE_ENV === "production",
    });
  }

  return res;
}
