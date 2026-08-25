import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signSession, ADMIN_COOKIE, DRIVER_COOKIE, CUSTOMER_COOKIE, type Role } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const { username, password, role } = body ?? {};
  const identifier = (username ?? body?.email ?? "").trim();
  if (!identifier || !password) {
    return NextResponse.json({ error: "Zugangsdaten erforderlich" }, { status: 400 });
  }

  // Rate-Limit (nur hinter Proxy/Ingress): Brute-Force bremsen.
  // Das Limit pro Benutzername greift IMMER – auch wenn keine IP feststellbar
  // ist. Sonst liesse sich der Bruteforce-Schutz dadurch aushebeln, dass man
  // die eigene IP unkenntlich macht.
  const perId = rateLimit(`login:id:${identifier.toLowerCase()}`, 20, 5 * 60_000);
  if (!perId.ok) {
    return NextResponse.json({ error: "Zu viele Anmeldeversuche. Bitte später erneut." }, { status: 429 });
  }
  const ip = clientIp(req);
  if (ip) {
    const perIp = rateLimit(`login:ip:${ip}`, 20, 5 * 60_000);
    if (!perIp.ok) {
      return NextResponse.json({ error: "Zu viele Anmeldeversuche. Bitte später erneut." }, { status: 429 });
    }
  }

  if (role === "ADMIN") {
    // Firma (Mandant) meldet sich mit E-Mail an.
    const company = await prisma.company.findUnique({ where: { email: identifier.toLowerCase() } });
    if (!company || !(await verifyPassword(password, company.passwordHash))) {
      return NextResponse.json({ error: "E-Mail oder Passwort falsch" }, { status: 401 });
    }
    const isSuper = company.slug === "_super";
    const token = signSession({
      sub: company.id,
      role: isSuper ? "SUPER_ADMIN" : "ADMIN",
      name: company.name,
      username: company.email,
      companyId: company.id,
      companySlug: company.slug,
    });
    return withCookie(
      NextResponse.json({ ok: true, role: isSuper ? "SUPER_ADMIN" : "ADMIN", name: company.name, slug: company.slug }),
      token,
      ADMIN_COOKIE,
    );
  }

  if (role === "CUSTOMER") {
    // Kunde meldet sich mit E-Mail an.
    const customer = await prisma.customer.findUnique({ where: { email: identifier.toLowerCase() } });
    if (!customer || !(await verifyPassword(password, customer.passwordHash))) {
      return NextResponse.json({ error: "E-Mail oder Passwort falsch" }, { status: 401 });
    }
    const token = signSession({
      sub: customer.id,
      role: "CUSTOMER",
      name: customer.name,
      username: customer.email,
      companyId: "",
      phone: customer.phone,
    });
    return withCookie(
      NextResponse.json({ ok: true, role: "CUSTOMER", name: customer.name }),
      token,
      CUSTOMER_COOKIE,
    );
  }

  // Fahrer meldet sich mit Benutzername an.
  const driver = await prisma.driver.findUnique({
    where: { username: identifier },
    include: { company: true },
  });
  if (!driver || !(await verifyPassword(password, driver.passwordHash))) {
    return NextResponse.json({ error: "Benutzername oder Passwort falsch" }, { status: 401 });
  }
  const token = signSession({
    sub: driver.id,
    role: "DRIVER",
    name: driver.name,
    username: driver.username,
    companyId: driver.companyId,
    companySlug: driver.company.slug,
  });
  return withCookie(NextResponse.json({ ok: true, role: "DRIVER", name: driver.name }), token, DRIVER_COOKIE);
}

function withCookie(res: NextResponse, token: string, cookieName: string) {
  res.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
