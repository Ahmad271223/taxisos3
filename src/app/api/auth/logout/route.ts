import { NextResponse } from "next/server";
import { SESSION_COOKIE, ADMIN_COOKIE, DRIVER_COOKIE, CUSTOMER_COOKIE, INSTITUTION_COOKIE, HOTEL_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ?scope=admin|driver meldet nur den jeweiligen Bereich ab (der andere bleibt
// eingeloggt). Ohne scope: alles abmelden.
export async function POST(req: Request) {
  const scope = new URL(req.url).searchParams.get("scope");
  const res = NextResponse.json({ ok: true });
  const clear = (name: string) => res.cookies.set(name, "", { httpOnly: true, path: "/", maxAge: 0 });
  if (scope === "driver") clear(DRIVER_COOKIE);
  else if (scope === "admin") clear(ADMIN_COOKIE);
  else if (scope === "customer") clear(CUSTOMER_COOKIE);
  else if (scope === "hotel") clear(HOTEL_COOKIE);
  else if (scope === "institution") clear(INSTITUTION_COOKIE);
  else {
    clear(ADMIN_COOKIE);
    clear(DRIVER_COOKIE);
    clear(CUSTOMER_COOKIE);
    clear(INSTITUTION_COOKIE);
    clear(HOTEL_COOKIE);
    clear(SESSION_COOKIE);
  }
  return res;
}
