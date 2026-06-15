import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// Zugriffsprotokoll (Phase F / DSGVO) – nur Admin. Letzte Zugriffe auf
// Gesundheits-/Patientendaten.
export async function GET(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const where = entity ? { entity } : {};
  const entries = await prisma.accessLog.findMany({
    where,
    orderBy: { at: "desc" },
    take: 200,
  });
  return NextResponse.json({ entries });
}
