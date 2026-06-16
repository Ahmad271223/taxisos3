import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;

// Charge-to-Room / Corporate Sammelabrechnung: alle aufs Zimmer/Firmenkonto
// gebuchten, abgeschlossenen Fahrten eines Monats. JSON + ?format=csv.
export async function GET(req: Request) {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const url = new URL(req.url);
  const monthParam = url.searchParams.get("month");
  const format = url.searchParams.get("format");
  const now = new Date();
  const [y, m] = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? monthParam.split("-").map((n) => parseInt(n, 10))
    : [now.getFullYear(), now.getMonth() + 1];
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const monthKey = `${y}-${String(m).padStart(2, "0")}`;
  const periodLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(start);

  const rides = await prisma.booking.findMany({
    where: {
      hotelId: session.sub,
      hotelPayment: { in: ["ROOM", "CORPORATE"] },
      status: "ABGESCHLOSSEN",
      completedAt: { gte: start, lt: end },
    },
    orderBy: { completedAt: "asc" },
    select: { id: true, completedAt: true, customerName: true, roomNumber: true, hotelPayment: true, pickupAddress: true, destAddress: true, fare: true },
  });

  const lines = rides.map((b) => ({
    id: b.id,
    date: (b.completedAt ?? start).toISOString(),
    guest: b.customerName,
    room: b.roomNumber ?? "",
    mode: b.hotelPayment === "CORPORATE" ? "Firmenkonto" : "Zimmer",
    route: `${b.pickupAddress} → ${b.destAddress}`,
    fare: r2(b.fare ?? 0),
  }));
  const total = { count: lines.length, fare: r2(lines.reduce((s, l) => s + l.fare, 0)) };

  if (format === "csv") {
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Datum", "Gast", "Zimmer", "Abrechnung", "Strecke", "Fahrpreis (EUR)"].join(";");
    const rows = lines.map((l) =>
      [new Date(l.date).toLocaleDateString("de-DE"), l.guest, l.room, l.mode, l.route, l.fare.toFixed(2).replace(".", ",")].map(esc).join(";"),
    );
    const csv = "﻿" + [header, ...rows].join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="Hotel_Abrechnung_${monthKey}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  return NextResponse.json({ monthKey, periodLabel, lines, total });
}
