import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const hotel = await prisma.hotel.findUnique({ where: { id: session.sub }, select: { preferredCompanyIds: true } });
  return NextResponse.json({ preferredCompanyIds: (hotel?.preferredCompanyIds ?? "").split(",").filter(Boolean) });
}

const schema = z.object({ preferredCompanyIds: z.array(z.string()).max(50) });

// Flotten-Whitelist speichern (bevorzugte Firmen).
export async function PATCH(req: Request) {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });

  // Nur existierende Firmen-IDs zulassen.
  const valid = await prisma.company.findMany({ where: { id: { in: parsed.data.preferredCompanyIds } }, select: { id: true } });
  const ids = valid.map((c) => c.id);
  await prisma.hotel.update({ where: { id: session.sub }, data: { preferredCompanyIds: ids.join(",") } });
  return NextResponse.json({ preferredCompanyIds: ids });
}
