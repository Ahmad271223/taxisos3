// Monatliche Provisions-Rechnung (Phase 4): die Plattform stellt jedem
// Unternehmen die Vermittlungsgebuehren (platformFee) eines Monats in Rechnung –
// netto + USt = brutto, mit Fahrten-Einzelaufstellung.

import { prisma } from "@/lib/prisma";
import { commissionRate } from "@/lib/commission";

export interface InvoiceLine {
  date: string; // ISO (completedAt)
  route: string;
  fare: number;
  rate: number; // 0.05 | 0.07
  fee: number; // platformFee
}

export interface InvoiceData {
  invoiceNo: string;
  monthKey: string; // "YYYY-MM"
  periodLabel: string; // "Juni 2026"
  issuedAt: string; // ISO (heute)
  issuer: { name: string; address: string; vatId: string; email: string };
  recipient: { name: string; slug: string; address: string; email: string; cityTier: string; ratePct: number };
  lines: InvoiceLine[];
  trips: number;
  grossRevenue: number; // Summe Fahrpreise (Info)
  net: number; // Summe Provision (Netto)
  vatRate: number; // 0.19
  vat: number;
  gross: number;
  // Optionale Anzeige-Extras fuer archivierte Rechnungen (Phase 6)
  dueLabel?: string; // "Fällig bis: dd.mm.yyyy"
  statusBadge?: string; // z. B. "BEZAHLT" | "ÜBERFÄLLIG" | "MAHNUNG 2"
  statusBadgeColor?: "green" | "red" | "gray";
}

const MONTH_RE = /^(\d{4})-(\d{2})$/;

// Akzeptiert "YYYY-MM" (kanonisch) oder "MM-YYYY"; gibt {year, month0, start, end} zurueck.
export function parseMonth(raw: string): { year: number; month: number; start: Date; end: Date } | null {
  let y: number, m: number;
  const iso = MONTH_RE.exec(raw);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
  } else {
    const alt = /^(\d{2})-(\d{4})$/.exec(raw);
    if (!alt) return null;
    m = Number(alt[1]);
    y = Number(alt[2]);
  }
  if (m < 1 || m > 12 || y < 2000 || y > 3000) return null;
  const start = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const end = new Date(y, m, 1, 0, 0, 0, 0);
  return { year: y, month: m, start, end };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function vatRate(): number {
  const v = Number(process.env.VAT_RATE);
  return Number.isFinite(v) && v >= 0 ? v : 0.19;
}

function issuer() {
  return {
    name: process.env.PLATFORM_NAME ?? "TaxiOS Plattform GmbH",
    address: process.env.PLATFORM_ADDRESS ?? "Bahnhofstraße 1, 30159 Hannover",
    vatId: process.env.PLATFORM_VAT_ID ?? "DE000000000",
    email: process.env.PLATFORM_EMAIL ?? "abrechnung@taxios.app",
  };
}

// Baut die Rechnungsdaten fuer ein Unternehmen + einen Monat.
// Liefert null, wenn die Firma unbekannt oder der Monat ungueltig ist.
export async function buildInvoice(companyId: string, monthRaw: string): Promise<InvoiceData | null> {
  const period = parseMonth(monthRaw);
  if (!period) return null;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return null;

  const bookings = await prisma.booking.findMany({
    where: {
      companyId,
      status: "ABGESCHLOSSEN",
      completedAt: { gte: period.start, lt: period.end },
    },
    orderBy: { completedAt: "asc" },
    select: {
      completedAt: true,
      pickupAddress: true,
      destAddress: true,
      fare: true,
      platformFee: true,
      platformFeeRate: true,
    },
  });

  const fallbackRate = commissionRate(company.cityTier);
  const lines: InvoiceLine[] = bookings.map((b) => ({
    date: (b.completedAt ?? period.start).toISOString(),
    route: `${b.pickupAddress} → ${b.destAddress}`,
    fare: r2(b.fare ?? 0),
    rate: b.platformFeeRate ?? fallbackRate,
    fee: r2(b.platformFee ?? 0),
  }));

  const grossRevenue = r2(lines.reduce((s, l) => s + l.fare, 0));
  const net = r2(lines.reduce((s, l) => s + l.fee, 0));
  const rate = vatRate();
  const vat = r2(net * rate);
  const gross = r2(net + vat);

  const monthKey = `${period.year}-${String(period.month).padStart(2, "0")}`;
  const periodLabel = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(period.start);
  const invoiceNo = `RE-${period.year}${String(period.month).padStart(2, "0")}-${company.id.slice(-6).toUpperCase()}`;

  return {
    invoiceNo,
    monthKey,
    periodLabel,
    issuedAt: new Date().toISOString(),
    issuer: issuer(),
    recipient: {
      name: company.name,
      slug: company.slug,
      address: company.address ?? "-",
      email: company.email,
      cityTier: company.cityTier,
      ratePct: Math.round(fallbackRate * 100),
    },
    lines,
    trips: lines.length,
    grossRevenue,
    net,
    vatRate: rate,
    vat,
    gross,
  };
}

// Sammel-Abrechnung (Phase 5): Rechnungen aller Mandanten (ohne _super) fuer
// einen Monat. Reihenfolge nach Firmenname.
export async function buildAllInvoices(monthRaw: string): Promise<InvoiceData[]> {
  if (!parseMonth(monthRaw)) return [];
  const companies = await prisma.company.findMany({
    where: { slug: { not: "_super" } },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  const out: InvoiceData[] = [];
  for (const c of companies) {
    const inv = await buildInvoice(c.id, monthRaw);
    if (inv) out.push(inv);
  }
  return out;
}
