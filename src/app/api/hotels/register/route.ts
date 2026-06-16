import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, authConfigured, HOTEL_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte alle Pflichtfelder ausfüllen (Passwort min. 6 Zeichen)." }, { status: 400 });
  }
  if (!authConfigured()) {
    return NextResponse.json({ error: "Server nicht vollständig konfiguriert (AUTH_SECRET)." }, { status: 500 });
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();

  if (await prisma.hotel.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "Diese E-Mail ist bereits registriert." }, { status: 409 });
  }

  const { hotel, token } = await prisma.$transaction(async (tx) => {
    const hotel = await tx.hotel.create({
      data: { name: d.name, email, passwordHash: await hashPassword(d.password), phone: d.phone ?? null, address: d.address ?? null },
    });
    const token = signSession({ sub: hotel.id, role: "HOTEL", name: hotel.name, username: hotel.email, companyId: hotel.id });
    return { hotel, token };
  });

  const res = NextResponse.json({ ok: true, id: hotel.id, name: hotel.name }, { status: 201 });
  res.cookies.set(HOTEL_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
  return res;
}
