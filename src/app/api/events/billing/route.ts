import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;

// Event-Abrechnung: alle Fahrten einer Veranstaltung, summiert nach Abholpunkt.
// JSON (Standard) oder CSV (?format=csv).
export async function GET(req: Request) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const url = new URL(req.url);
  const eventId = url.searchParams.get("eventId") ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, eventHostId: true, name: true } });
  if (!event || event.eventHostId !== session.sub) return NextResponse.json({ error: "Event nicht gefunden" }, { status: 404 });

  const rides = await prisma.booking.findMany({
    where: { eventId, status: { not: "STORNIERT" } },
    select: { id: true, pickupPoint: true, customerName: true, pickupAddress: true, destAddress: true, fare: true, priceApprox: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  const lines = rides.map((b) => ({
    id: b.id,
    point: b.pickupPoint || "—",
    name: b.customerName,
    route: `${b.pickupAddress} -> ${b.destAddress}`,
    amount: r2(b.fare ?? b.priceApprox ?? 0),
    done: b.status === "ABGESCHLOSSEN",
  }));
  const total = r2(lines.reduce((s, l) => s + l.amount, 0));

  // Gruppierung nach Abholpunkt.
  const map = new Map<string, { count: number; amount: number }>();
  for (const l of lines) {
    const cur = map.get(l.point) ?? { count: 0, amount: 0 };
    map.set(l.point, { count: cur.count + 1, amount: r2(cur.amount + l.amount) });
  }
  const byPoint = Array.from(map.entries()).map(([point, v]) => ({ point, ...v })).sort((a, b) => b.amount - a.amount);

  if (url.searchParams.get("format") === "csv") {
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Abholpunkt", "Fahrgast", "Fahrt", "Betrag (EUR)"].join(";");
    const rows = lines.map((l) => [l.point, l.name, l.route, l.amount.toFixed(2).replace(".", ",")].map(esc).join(";"));
    const csv = "﻿" + [header, ...rows].join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="Event_${event.name.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 30)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return NextResponse.json({ event: event.name, lines, byPoint, total });
}
