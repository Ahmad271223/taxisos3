import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { generateCorporateCode } from "@/lib/corporate";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const codes = await prisma.corporateCode.findMany({ where: { eventHostId: session.sub }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ codes });
}

const schema = z.object({
  label: z.string().max(120).optional().nullable(),
  // Beträge in EUR (Frontend), serverseitig in Cent gespeichert.
  budgetEuro: z.number().min(0).max(1_000_000).optional().nullable(),
  maxRides: z.number().int().min(1).max(100_000).optional().nullable(),
  perRideEuro: z.number().min(0).max(100_000).optional().nullable(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

export async function POST(req: Request) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
  const d = parsed.data;

  // Eindeutigen Code erzeugen (sehr selten Kollision -> wenige Versuche).
  let code = generateCorporateCode();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.corporateCode.findUnique({ where: { code } });
    if (!exists) break;
    code = generateCorporateCode();
  }

  const created = await prisma.corporateCode.create({
    data: {
      eventHostId: session.sub,
      code,
      label: d.label || null,
      budgetCents: d.budgetEuro != null ? Math.round(d.budgetEuro * 100) : null,
      maxRides: d.maxRides ?? null,
      perRideCents: d.perRideEuro != null ? Math.round(d.perRideEuro * 100) : null,
      validUntil: d.validUntil || null,
    },
  });
  return NextResponse.json({ code: created }, { status: 201 });
}
