// Monats-Abrechnung einer Einrichtung (Phase E): zentrale Aggregation, genutzt
// von der JSON-API und der PDF-Erzeugung. On-the-fly (kein Snapshot).
//
// ABRECHNUNG JE TAXIUNTERNEHMEN: Die Befoerderungsleistung erbringt das
// jeweilige Taxiunternehmen, und der Fahrpreis geht zu 100 % dorthin. Eine
// Sammel-Aufstellung im Namen der Plattform waere als Rechnung schlicht falsch
// (die Plattform stellt hier keine Leistung in Rechnung). Deshalb wird der
// Monat zusaetzlich in ABSCHNITTE JE UNTERNEHMEN gegliedert – jeder Abschnitt
// traegt Aussteller, Rechnungsnummer und USt-Ausweis des Unternehmens.
//
// Die flachen Felder (lines, totalBillable, ...) bleiben erhalten: das Portal
// und die bestehenden Tests lesen sie weiterhin.

import { prisma } from "@/lib/prisma";
import { taxiVatRate } from "@/lib/ridePdf";

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
  companyName: string | null;
  distanceMeters: number | null;
}

export interface CompanySection {
  company: {
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    taxId: string | null;
    vatId: string | null;
  } | null; // null = Fahrt noch keinem Unternehmen zugewiesen (nachrichtlich)
  invoiceNo: string | null; // nur fuer echte Unternehmens-Abschnitte
  lines: StatementLine[];
  completed: number;
  totalBillable: number;
  totalPlanned: number;
  // USt-Ausweis auf die abrechenbaren (Brutto-)Betraege, getrennt nach Satz
  // (7 % bis 50 km Befoerderungsstrecke, sonst 19 %).
  vat: { rate: number; gross: number; net: number; tax: number }[];
}

export interface InstitutionStatement {
  monthKey: string;
  periodLabel: string;
  /** Rechnungsdatum (Erzeugungszeitpunkt der Abrechnung). */
  issuedAtIso: string;
  institution: { name: string; type: string; address: string | null } | null;
  rides: number;
  completed: number;
  totalBillable: number;
  totalPlanned: number;
  lines: StatementLine[];
  sections: CompanySection[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function vatBreakdown(lines: StatementLine[]): CompanySection["vat"] {
  const beträge = new Map<number, number>();
  for (const l of lines) {
    if (!l.billable) continue;
    const rate = taxiVatRate(l.distanceMeters);
    beträge.set(rate, (beträge.get(rate) ?? 0) + (l.amount ?? 0));
  }
  return [...beträge.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, gross]) => {
      const net = round2(gross / (1 + rate));
      return { rate, gross: round2(gross), net, tax: round2(gross - net) };
    });
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
      fare: true, priceApprox: true, payerType: true, distanceMeters: true,
      companyId: true,
      company: { select: { id: true, name: true, address: true, phone: true, email: true, taxId: true, vatId: true } },
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
    companyName: b.company?.name ?? null,
    distanceMeters: b.distanceMeters ?? null,
  }));

  // ---- Abschnitte je Unternehmen ----
  const nachFirma = new Map<string, { company: CompanySection["company"]; lines: StatementLine[] }>();
  bookings.forEach((b, i) => {
    const schluessel = b.companyId ?? "__offen__";
    if (!nachFirma.has(schluessel)) {
      nachFirma.set(schluessel, { company: b.company ?? null, lines: [] });
    }
    nachFirma.get(schluessel)!.lines.push(lines[i]);
  });

  const instKurz = institutionId.slice(-4).toUpperCase();
  const sections: CompanySection[] = [...nachFirma.values()]
    .sort((a, b) => (a.company?.name ?? "￿").localeCompare(b.company?.name ?? "￿"))
    .map(({ company, lines: sl }) => {
      const fertig = sl.filter((l) => l.billable);
      return {
        company,
        invoiceNo: company ? `KF-${monthKey.replace("-", "")}-${company.id.slice(-4).toUpperCase()}-${instKurz}` : null,
        lines: sl,
        completed: fertig.length,
        totalBillable: round2(fertig.reduce((s, l) => s + (l.amount ?? 0), 0)),
        totalPlanned: round2(sl.filter((l) => !l.billable).reduce((s, l) => s + (l.amount ?? 0), 0)),
        vat: vatBreakdown(sl),
      };
    });

  const completed = lines.filter((l) => l.billable);
  const inst = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: { name: true, type: true, address: true },
  });

  return {
    monthKey,
    periodLabel,
    issuedAtIso: new Date().toISOString(),
    institution: inst,
    rides: lines.length,
    completed: completed.length,
    totalBillable: round2(completed.reduce((s, l) => s + (l.amount ?? 0), 0)),
    totalPlanned: round2(lines.filter((l) => !l.billable).reduce((s, l) => s + (l.amount ?? 0), 0)),
    lines,
    sections,
  };
}
