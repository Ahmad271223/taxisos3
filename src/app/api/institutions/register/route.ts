import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, INSTITUTION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2),
  type: z.enum(["KLINIK", "PFLEGEHEIM", "DIALYSE", "REHA"]).optional(),
  email: z.string().email(),
  // Dieses Konto verwaltet Patientendaten (Name, Mobilitaet, Versicherung).
  password: z.string().min(8),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  // Ohne Bremse liessen sich massenhaft Konten anlegen (Einrichtungen).
  const ip = clientIp(req);
  if (ip && !rateLimit(`register-institution:${ip}`, 5, 10 * 60_000).ok) {
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
    return NextResponse.json({ error: "Bitte alle Pflichtfelder ausfüllen (Passwort min. 8 Zeichen)." }, { status: 400 });
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();

  if (await prisma.institution.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "Diese E-Mail ist bereits registriert." }, { status: 409 });
  }

  // FREIGABE: Eine Einrichtung darf Patientendaten anlegen und Krankenfahrten
  // ausloesen. Wer sich hier eintraegt, behauptet lediglich, eine Klinik oder
  // ein Pflegeheim zu sein - geprueft wird das von niemandem. Im Echtbetrieb
  // entsteht das Konto deshalb GESPERRT und muss von der Plattform
  // freigeschaltet werden (Super-Admin: PATCH /api/super/institutions).
  // Im Test- und Entwicklungsbetrieb bleibt die Selbstfreischaltung an, sonst
  // waere kein Durchlauf ohne Handgriff moeglich.
  const freigabePflicht =
    process.env.INSTITUTION_APPROVAL === "1" ||
    (process.env.NODE_ENV === "production" && process.env.INSTITUTION_APPROVAL !== "0");

  const inst = await prisma.institution.create({
    data: {
      name: d.name,
      type: d.type ?? "KLINIK",
      email,
      passwordHash: await hashPassword(d.password),
      phone: d.phone ?? null,
      address: d.address ?? null,
      active: !freigabePflicht,
    },
  });

  // Gesperrt angelegt: keine Sitzung ausstellen. Sonst koennte das Konto trotz
  // fehlender Freigabe sofort weiterarbeiten.
  if (freigabePflicht) {
    return NextResponse.json(
      {
        ok: true,
        pending: true,
        id: inst.id,
        name: inst.name,
        message:
          "Vielen Dank. Wir prüfen Ihre Einrichtung und schalten den Zugang frei – Sie erhalten eine Nachricht, sobald Sie loslegen können.",
      },
      { status: 202 },
    );
  }

  const token = signSession({
    sub: inst.id,
    role: "INSTITUTION",
    name: inst.name,
    username: inst.email,
    companyId: inst.id,
  });
  const res = NextResponse.json({ ok: true, id: inst.id, name: inst.name }, { status: 201 });
  res.cookies.set(INSTITUTION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
  return res;
}
