import { NextResponse } from "next/server";
import { logAccess } from "@/lib/accessLog";
import { portalCan } from "@/lib/portalRoles";

// Unterkonten eines Veranstalters (portalRole) hatten bisher dieselben Rechte
// wie der Inhaber: die Sitzung laeuft aus technischen Gruenden unter der ID
// des Hauptkontos, und geprueft wurde die Rolle nirgends. Eine Kraft mit
// der Rolle "Buchhaltung" konnte damit Rabattcodes anlegen und Fahrten
// buchen. Jetzt entscheidet portalCan() ueber jeden schreibenden Zugriff.
import { csvFeld } from "@/lib/csv";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;

// Event-Abrechnung: alle Fahrten einer Veranstaltung, summiert nach Abholpunkt.
// JSON (Standard) oder CSV (?format=csv).
export async function GET(req: Request) {
  const session = requireRole("EVENT");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!portalCan(session.portalRole, "invoices")) {
    return NextResponse.json({ error: "Ihre Rolle darf keine Abrechnungen einsehen." }, { status: 403 });
  }
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
    // Ist der Betrag der tatsaechlich abgerechnete Fahrpreis oder erst eine
    // Schaetzung? Beides in einer Summe zu vermischen hat die Abrechnung wie
    // eine Rechnung aussehen lassen, obwohl geplante Fahrten mit drinsteckten.
    final: b.status === "ABGESCHLOSSEN" && b.fare != null,
    done: b.status === "ABGESCHLOSSEN",
  }));
  const abgerechnet = r2(lines.filter((l) => l.final).reduce((s, l) => s + l.amount, 0));
  const geschaetzt = r2(lines.filter((l) => !l.final).reduce((s, l) => s + l.amount, 0));
  const total = r2(abgerechnet + geschaetzt);

  // Gruppierung nach Abholpunkt.
  const map = new Map<string, { count: number; amount: number }>();
  for (const l of lines) {
    const cur = map.get(l.point) ?? { count: 0, amount: 0 };
    map.set(l.point, { count: cur.count + 1, amount: r2(cur.amount + l.amount) });
  }
  const byPoint = Array.from(map.entries()).map(([point, v]) => ({ point, ...v })).sort((a, b) => b.amount - a.amount);

  if (url.searchParams.get("format") === "csv") {
    const esc = csvFeld;
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

  // Sensibler Export (Fahrgastnamen, Strecken) – wie bei der Kranken- und der
  // Einrichtungsabrechnung protokollieren.
  await logAccess({
    actorType: "ADMIN",
    actorId: session.sub,
    action: "EXPORT",
    entity: "BOOKING",
    detail: `Event-Abrechnung ${event.name} (${lines.length} Fahrten)`,
  });
  return NextResponse.json({ event: event.name, lines, byPoint, abgerechnet, geschaetzt, total });
}
