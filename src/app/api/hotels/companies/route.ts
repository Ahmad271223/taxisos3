import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// Aktive Taxifirmen für die Flotten-Whitelist-Auswahl im Hotel-Portal.
export async function GET() {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const companies = await prisma.company.findMany({
    where: { slug: { not: "_super" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
  return NextResponse.json({ companies });
}
