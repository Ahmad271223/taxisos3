import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]).optional(),
  adminNote: z.string().max(2000).nullable().optional(),
});

// Ticket-Status/Notiz aktualisieren (Super-Admin).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const existing = await prisma.supportTicket.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  const ticket = await prisma.supportTicket.update({ where: { id: params.id }, data: parsed.data });
  return NextResponse.json({ ticket });
}
