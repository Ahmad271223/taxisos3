import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { getDispatcher } from "@/server/runtime";

export const dynamic = "force-dynamic";

const schema = z.object({
  reason: z.string().max(500).optional().nullable(),
});

/** Admin-Stornierung (jederzeit moeglich). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const booking = await prisma.booking.findUnique({ where: { id: params.id } });
  if (!booking) {
    return NextResponse.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
  }
  // Admin darf nur eigene Buchungen stornieren (sobald firmenZuordnung existiert).
  if (booking.companyId && booking.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 403 });
  }
  if (booking.status === "ABGESCHLOSSEN" || booking.status === "STORNIERT") {
    return NextResponse.json({ error: "Diese Fahrt ist bereits beendet." }, { status: 409 });
  }

  let reason: string | null = null;
  try {
    const json = await req.json();
    const parsed = schema.safeParse(json);
    reason = parsed.success ? parsed.data.reason ?? null : null;
  } catch {
    /* body optional */
  }

  await getDispatcher()?.cancelBooking(params.id, { actorType: "ADMIN", reason: reason ?? undefined });
  return NextResponse.json({ ok: true });
}
