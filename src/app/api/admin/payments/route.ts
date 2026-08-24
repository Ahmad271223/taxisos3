import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

// Zahlungsuebersicht fuer das Taxiunternehmen.
// Wichtig fuer Punkt 14: abgeschlossene Fahrten, deren Zahlung noch NICHT
// durchgelaufen ist, duerfen nicht als erfolgreich bezahlt erscheinen.
export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const rides = await prisma.booking.findMany({
    where: {
      companyId: session.companyId,
      status: "ABGESCHLOSSEN",
      completedAt: { gte: since },
    },
    select: {
      id: true,
      customerName: true,
      pickupAddress: true,
      destAddress: true,
      completedAt: true,
      fare: true,
      tip: true,
      paymentMethod: true,
      paymentStatus: true,
      paymentError: true,
      driver: { select: { name: true } },
    },
    orderBy: { completedAt: "desc" },
    take: 200,
  });

  const label = (r: (typeof rides)[number]) => {
    if (r.paymentMethod === "CASH") return { key: "BAR", text: "Bar beim Fahrer" };
    if (r.paymentMethod === "FIRMA") return { key: "FIRMA", text: "Von Firma übernommen" };
    if (r.paymentStatus === "BEZAHLT") return { key: "BEZAHLT", text: "Bezahlt" };
    if (r.paymentStatus === "FEHLGESCHLAGEN") return { key: "AUSSTEHEND", text: "Zahlung ausstehend" };
    return { key: "LAEUFT", text: "Zahlung läuft" };
  };

  const list = rides.map((r) => {
    const l = label(r);
    return {
      id: r.id,
      customerName: r.customerName,
      route: `${String(r.pickupAddress).split(",")[0]} → ${String(r.destAddress).split(",")[0]}`,
      driver: r.driver?.name ?? null,
      completedAt: r.completedAt,
      fare: r.fare ?? 0,
      tip: r.tip ?? 0,
      total: Math.round(((r.fare ?? 0) + (r.tip ?? 0)) * 100) / 100,
      paymentMethod: r.paymentMethod,
      paymentStatus: r.paymentStatus,
      paymentError: r.paymentError,
      statusKey: l.key,
      statusText: l.text,
    };
  });

  const open = list.filter((r) => r.statusKey === "AUSSTEHEND" || r.statusKey === "LAEUFT");
  const sum = (arr: typeof list) => Math.round(arr.reduce((s, r) => s + r.total, 0) * 100) / 100;

  return NextResponse.json({
    rides: list,
    // Kennzahlen fuer das Dashboard
    openCount: open.length,
    openAmount: sum(open),
    failedCount: list.filter((r) => r.statusKey === "AUSSTEHEND").length,
    paidAmount: sum(list.filter((r) => r.statusKey === "BEZAHLT")),
    cashAmount: sum(list.filter((r) => r.statusKey === "BAR")),
    // Transparenz: die Plattform behaelt nichts ein.
    commissionPercent: 0,
  });
}
