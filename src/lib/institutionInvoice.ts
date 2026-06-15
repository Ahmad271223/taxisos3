// Monats-Abrechnung einer Einrichtung (Phase E): zentrale Aggregation, genutzt
// von der JSON-API und der PDF-Erzeugung. On-the-fly (kein Snapshot).

import { prisma } from "@/lib/prisma";

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

export interface StatementLine {
  id: string;
  date: string;
  patient: string;
  route: string;
  status: string;
  payerType: string | null;
  billable: boolean;
  amount: number;
}

export interface InstitutionStatement {
  monthKey: string;
  periodLabel: string;
  institution: { name: string; type: string; address: string | null } | null;
  rides: number;
  completed: number;
  totalBillable: number;
  totalPlanned: number;
  lines: StatementLine[];
}

export async function buildInstitutionStatement(
  institutionId: string,
  monthParam?: string | null,
): Promise<InstitutionStatement> {
  const now = new Date();
  const [y, m] =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam.split("-").map((n) => parseInt(n, 10))
      : [now.getFullYear(), now.getMonth() + 1];
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const monthKey = `${y}-${String(m).padStart(2, "0")}`;
  const periodLabel = `${MONTHS_DE[m - 1]} ${y}`;

  const bookings = await prisma.booking.findMany({
    where: { institutionId, createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, createdAt: true, completedAt: true, scheduledAt: true, status: true,
      patientName: true, customerName: true, pickupAddress: true, destAddress: true,
      fare: true, priceApprox: true, payerType: true,
    },
  });

  const lines: StatementLine[] = bookings.map((b) => ({
    id: b.id,
    date: (b.completedAt ?? b.scheduledAt ?? b.createdAt).toISOString(),
    patient: b.patientName ?? b.customerName,
    route: `${b.pickupAddress} → ${b.destAddress}`,
    status: b.status,
    payerType: b.payerType ?? null,
    billable: b.status === "ABGESCHLOSSEN",
    amount: b.status === "ABGESCHLOSSEN" ? (b.fare ?? 0) : (b.priceApprox ?? 0),
  }));

  const completed = lines.filter((l) => l.billable);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const inst = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: { name: true, type: true, address: true },
  });

  return {
    monthKey,
    periodLabel,
    institution: inst,
    rides: lines.length,
    completed: completed.length,
    totalBillable: round2(completed.reduce((s, l) => s + (l.amount ?? 0), 0)),
    totalPlanned: round2(lines.filter((l) => !l.billable).reduce((s, l) => s + (l.amount ?? 0), 0)),
    lines,
  };
}
