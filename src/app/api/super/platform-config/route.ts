import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { getPlatformConfig, setPlatformConfig } from "@/lib/platformConfig";

export const dynamic = "force-dynamic";

/** Plattform-Leitplanken + Kassentarif lesen (Super-Admin). */
export async function GET() {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  return NextResponse.json({ config: await getPlatformConfig() });
}

const schema = z.object({
  minBaseFare: z.number().min(0).max(1000),
  minPerKm: z.number().min(0).max(100),
  insuranceBaseFare: z.number().min(0).max(1000),
  insurancePerKm: z.number().min(0).max(100),
});

/** Leitplanken + Kassentarif setzen (Super-Admin). */
export async function PUT(req: Request) {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Werte" }, { status: 400 });
  return NextResponse.json({ config: await setPlatformConfig(parsed.data) });
}
