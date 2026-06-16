import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";
import { medicalLabel } from "@/lib/medical";

export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

// Krankenkassen-Sammelabrechnung fürs Taxiunternehmen: abgeschlossene
// Krankenfahrten eines Monats, gruppiert je Kostenträger, mit km/Fahrpreis je
// Fahrt. JSON für die UI, ?format=csv für den Export (deutsches Excel-Format).
export async function GET(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const companyId = session.companyId;

  const url = new URL(req.url);
  const monthParam = url.searchParams.get("month");
  const format = url.searchParams.get("format");
  const now = new Date();
  const [y, m] =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam.split("-").map((n) => parseInt(n, 10))
      : [now.getFullYear(), now.getMonth() + 1];
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const monthKey = `${y}-${String(m).padStart(2, "0")}`;
  const periodLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(start);

  const rides = await prisma.booking.findMany({
    where: { companyId, medicalType: { not: null }, status: "ABGESCHLOSSEN", completedAt: { gte: start, lt: end } },
    orderBy: { completedAt: "asc" },
    select: {
      id: true, completedAt: true, patientName: true, customerName: true, medicalType: true,
      payerType: true, insuranceName: true, insuranceNumber: true, pickupAddress: true, destAddress: true,
      distanceMeters: true, fare: true,
    },
  });

  const lines = rides.map((b) => ({
    id: b.id,
    date: (b.completedAt ?? start).toISOString(),
    patient: b.patientName ?? b.customerName,
    type: medicalLabel(b.medicalType) ?? b.medicalType ?? "",
    payer: b.payerType === "INSURANCE" ? (b.insuranceName || "Krankenkasse (ohne Name)") : "Privatzahler",
    insuranceNumber: b.insuranceNumber ?? "",
    route: `${b.pickupAddress} → ${b.destAddress}`,
    km: b.distanceMeters != null ? r1(b.distanceMeters / 1000) : null,
    fare: r2(b.fare ?? 0),
  }));

  const groupMap = new Map<string, { payer: string; count: number; km: number; fare: number }>();
  for (const l of lines) {
    const cur = groupMap.get(l.payer) ?? { payer: l.payer, count: 0, km: 0, fare: 0 };
    cur.count++;
    cur.km += l.km ?? 0;
    cur.fare += l.fare;
    groupMap.set(l.payer, cur);
  }
  const groups = [...groupMap.values()].map((g) => ({ ...g, km: r1(g.km), fare: r2(g.fare) })).sort((a, b) => b.fare - a.fare);
  const total = {
    count: lines.length,
    km: r1(lines.reduce((s, l) => s + (l.km ?? 0), 0)),
    fare: r2(lines.reduce((s, l) => s + l.fare, 0)),
  };

  if (format === "csv") {
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Datum", "Patient", "Fahrtart", "Kostenträger", "Vers.-Nr.", "Strecke", "km", "Fahrpreis (EUR)"].join(";");
    const rows = lines.map((l) =>
      [
        new Date(l.date).toLocaleDateString("de-DE"),
        l.patient, l.type, l.payer, l.insuranceNumber, l.route,
        l.km ?? "", l.fare.toFixed(2).replace(".", ","),
      ].map(esc).join(";"),
    );
    const csv = "﻿" + [header, ...rows].join("\r\n"); // BOM -> Excel erkennt UTF-8
    await logAccess({ actorType: "ADMIN", actorId: session.sub, action: "EXPORT", entity: "BOOKING", detail: `Kassen-CSV ${monthKey} (${lines.length})` });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="Krankenkassen_${monthKey}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  await logAccess({ actorType: "ADMIN", actorId: session.sub, action: "EXPORT", entity: "BOOKING", detail: `Kassen-Abrechnung ${monthKey}` });
  return NextResponse.json({ monthKey, periodLabel, groups, lines, total });
}
