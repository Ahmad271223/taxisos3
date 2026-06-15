import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSession, INSTITUTION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().min(2),
  type: z.enum(["KLINIK", "PFLEGEHEIM", "DIALYSE", "REHA"]).optional(),
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
  const d = parsed.data;
  const email = d.email.toLowerCase();

  if (await prisma.institution.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "Diese E-Mail ist bereits registriert." }, { status: 409 });
  }

  const inst = await prisma.institution.create({
    data: {
      name: d.name,
      type: d.type ?? "KLINIK",
      email,
      passwordHash: await hashPassword(d.password),
      phone: d.phone ?? null,
      address: d.address ?? null,
    },
  });

  const token = signSession({
    sub: inst.id,
    role: "INSTITUTION",
    name: inst.name,
    username: inst.email,
    companyId: inst.id,
  });
  const res = NextResponse.json({ ok: true, id: inst.id, name: inst.name }, { status: 201 });
  res.cookies.set(INSTITUTION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600 });
  return res;
}
