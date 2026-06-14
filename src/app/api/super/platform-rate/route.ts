import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getPlatformRate, computePlatformRate } from "@/lib/platformRate";

export const dynamic = "force-dynamic";

/** Aktuellen Plattform-Durchschnittstarif lesen (Super-Admin). */
export async function GET() {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  return NextResponse.json({ rate: await getPlatformRate() });
}

/** Durchschnittstarif sofort neu berechnen (sonst täglich 02:00). */
export async function POST() {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  return NextResponse.json({ ok: true, rate: await computePlatformRate() });
}
