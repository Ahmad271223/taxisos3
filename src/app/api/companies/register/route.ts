import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, authConfigured, ADMIN_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email(),
  password: z.string().min(6),
  cityTier: z.enum(["BIG", "SMALL"]).optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "firma";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let i = 1;
  while (await prisma.company.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

export async function POST(req: Request) {
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte alle Pflichtfelder korrekt ausfüllen (Passwort min. 6 Zeichen)." }, { status: 400 });
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();

  // Früh prüfen: ohne gültiges AUTH_SECRET würde das spätere Signieren der
  // Session werfen – DANN aber wäre die Firma schon angelegt ("Leichen-Firma",
  // führt beim nächsten Versuch zu 409). Daher hier abbrechen, BEVOR etwas
  // geschrieben wird, mit einer klaren Meldung (Server-Fehlkonfiguration).
  if (!authConfigured()) {
    console.error("Registrierung abgebrochen: AUTH_SECRET ist nicht (gültig) gesetzt.");
    return NextResponse.json(
      { error: "Der Server ist nicht vollständig konfiguriert (AUTH_SECRET). Bitte den Betreiber kontaktieren." },
      { status: 500 },
    );
  }

  if (await prisma.company.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "Diese E-Mail ist bereits registriert." }, { status: 409 });
  }

  try {
    const slug = await uniqueSlug(slugify(d.name));
    const passwordHash = await hashPassword(d.password);

    // Firma + Session-Token atomar erzeugen: scheitert das Signieren (z. B.
    // ungültiges AUTH_SECRET), rollt die Transaktion die Firma zurück -> es
    // bleibt keine halbe Registrierung zurück.
    const { company, token } = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: d.name,
          slug,
          address: d.address ?? null,
          phone: d.phone ?? null,
          email,
          passwordHash,
          cityTier: d.cityTier ?? "SMALL",
          pricing: { create: {} }, // Standardtarife
        },
      });
      const token = signSession({
        sub: company.id,
        role: "ADMIN",
        name: company.name,
        username: company.email,
        companyId: company.id,
        companySlug: company.slug,
      });
      return { company, token };
    });

    const res = NextResponse.json({ ok: true, slug: company.slug, name: company.name }, { status: 201 });
    res.cookies.set(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  } catch (err) {
    console.error("Registrierung fehlgeschlagen:", err);
    return NextResponse.json({ error: "Registrierung fehlgeschlagen. Bitte erneut versuchen." }, { status: 500 });
  }
}
