import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// Aktive Taxifirmen für die Flotten-Whitelist-Auswahl im Hotel-Portal.
export async function GET() {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const companies = await prisma.company.findMany({
    // Der Kommentar sprach von "aktiven" Firmen, gefiltert wurde aber nur das
    // Plattformkonto heraus. Ein Hotel konnte damit ein Unternehmen bevorzugen,
    // dessen Abo gekuendigt oder ueberfaellig ist - die Kennung landete danach
    // wirklich in den Fahrten (preferredCompanyIds) und die Vermittlung lief ins
    // Leere.
    where: {
      slug: { not: "_super" },
      subscriptionStatus: { notIn: ["GEKUENDIGT", "UEBERFAELLIG"] },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
  return NextResponse.json({ companies });
}
