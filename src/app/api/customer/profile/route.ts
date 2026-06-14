import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Kundenprofil inkl. Punkte/Bonus (Phase 18) + Notfallkontakt (Phase 17).
export async function GET() {
  const session = getSession("customer");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const c = await prisma.customer.findUnique({ where: { id: session.sub } });
  if (!c) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({
    profile: {
      name: c.name,
      email: c.email,
      phone: c.phone,
      points: c.points,
      emergencyContactName: c.emergencyContactName ?? null,
      emergencyContactPhone: c.emergencyContactPhone ?? null,
    },
  });
}

const schema = z.object({
  emergencyContactName: z.string().max(120).optional().nullable(),
  emergencyContactPhone: z.string().max(40).optional().nullable(),
});

export async function PATCH(req: Request) {
  const session = getSession("customer");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  const c = await prisma.customer.update({
    where: { id: session.sub },
    data: {
      emergencyContactName: parsed.data.emergencyContactName ?? null,
      emergencyContactPhone: parsed.data.emergencyContactPhone ?? null,
    },
  });
  return NextResponse.json({
    profile: {
      name: c.name,
      email: c.email,
      phone: c.phone,
      points: c.points,
      emergencyContactName: c.emergencyContactName ?? null,
      emergencyContactPhone: c.emergencyContactPhone ?? null,
    },
  });
}
