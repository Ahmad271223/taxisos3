// Rechnungs-Archiv (Phase 6): Festschreiben (issue), Lebenszyklus (offen/
// bezahlt/storniert), Überfälligkeit, Mahnungen und Zahlungsabgleich.
// Eine festgeschriebene Rechnung ist ein unveränderlicher Snapshot.

import { prisma } from "@/lib/prisma";
import { buildInvoice, type InvoiceData } from "@/lib/invoice";

export const DUE_DAYS = 14;

function dmy(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function isOverdue(inv: { status: string; dueAt: Date }): boolean {
  return inv.status === "OFFEN" && inv.dueAt.getTime() < Date.now();
}

export interface IssueResult {
  ok: boolean;
  created?: boolean;
  invoice?: any;
  error?: string;
}

// Rechnung festschreiben (idempotent pro companyId+monthKey). Eine bereits
// ausgestellte Rechnung wird NICHT überschrieben, sondern unverändert geliefert.
export async function issueInvoice(companyId: string, month: string): Promise<IssueResult> {
  // buildInvoice liefert den kanonischen monthKey (YYYY-MM) – danach idempotent prüfen.
  const data = await buildInvoice(companyId, month);
  if (!data) return { ok: false, error: "Rechnung konnte nicht erstellt werden." };

  const existing = await prisma.invoice
    .findUnique({ where: { companyId_monthKey: { companyId, monthKey: data.monthKey } } })
    .catch(() => null);
  if (existing) return { ok: true, created: false, invoice: existing };

  if (data.trips <= 0 || data.net <= 0) {
    return { ok: false, error: "Keine abrechenbaren Fahrten in diesem Monat." };
  }

  const issuedAt = new Date();
  const dueAt = new Date(issuedAt.getTime() + DUE_DAYS * 24 * 3600 * 1000);
  try {
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNo: data.invoiceNo,
        companyId,
        monthKey: data.monthKey,
        periodLabel: data.periodLabel,
        trips: data.trips,
        grossRevenue: data.grossRevenue,
        net: data.net,
        vatRate: data.vatRate,
        vat: data.vat,
        gross: data.gross,
        linesJson: JSON.stringify(data.lines),
        issuerJson: JSON.stringify(data.issuer),
        recipientJson: JSON.stringify(data.recipient),
        status: "OFFEN",
        issuedAt,
        dueAt,
      },
    });
    return { ok: true, created: true, invoice };
  } catch (e: any) {
    // Race: parallel angelegt -> existierende zurückgeben.
    const again = await prisma.invoice.findUnique({
      where: { companyId_monthKey: { companyId, monthKey: data.monthKey } },
    });
    if (again) return { ok: true, created: false, invoice: again };
    return { ok: false, error: e?.message ?? "invoice_create_error" };
  }
}

// Snapshot -> InvoiceData (für PDF), inkl. Status-Badge + Fälligkeit.
export function invoiceToData(inv: any): InvoiceData {
  let statusBadge: string | undefined;
  let statusBadgeColor: "green" | "red" | "gray" | undefined;
  if (inv.status === "BEZAHLT") {
    statusBadge = "BEZAHLT";
    statusBadgeColor = "green";
  } else if (inv.status === "STORNIERT") {
    statusBadge = "STORNIERT";
    statusBadgeColor = "gray";
  } else if (isOverdue(inv)) {
    statusBadge = inv.remindersSent > 0 ? `MAHNUNG ${inv.remindersSent}` : "ÜBERFÄLLIG";
    statusBadgeColor = "red";
  }
  return {
    invoiceNo: inv.invoiceNo,
    monthKey: inv.monthKey,
    periodLabel: inv.periodLabel,
    issuedAt: new Date(inv.issuedAt).toISOString(),
    issuer: JSON.parse(inv.issuerJson),
    recipient: JSON.parse(inv.recipientJson),
    lines: JSON.parse(inv.linesJson),
    trips: inv.trips,
    grossRevenue: inv.grossRevenue,
    net: inv.net,
    vatRate: inv.vatRate,
    vat: inv.vat,
    gross: inv.gross,
    dueLabel: `Fällig bis: ${dmy(new Date(inv.dueAt))}`,
    statusBadge,
    statusBadgeColor,
  };
}

// JSON-sicherer DTO für Listen-/Status-Ansichten.
export function invoiceDTO(inv: any) {
  return {
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    companyId: inv.companyId,
    monthKey: inv.monthKey,
    periodLabel: inv.periodLabel,
    trips: inv.trips,
    net: inv.net,
    vat: inv.vat,
    gross: inv.gross,
    status: inv.status,
    overdue: isOverdue(inv),
    issuedAt: new Date(inv.issuedAt).toISOString(),
    dueAt: new Date(inv.dueAt).toISOString(),
    paidAt: inv.paidAt ? new Date(inv.paidAt).toISOString() : null,
    paymentRef: inv.paymentRef ?? null,
    remindersSent: inv.remindersSent,
    lastReminderAt: inv.lastReminderAt ? new Date(inv.lastReminderAt).toISOString() : null,
    company: inv.company ? { name: inv.company.name, slug: inv.company.slug, email: inv.company.email } : undefined,
  };
}

export async function markPaid(id: string, ref?: string | null) {
  return prisma.invoice.update({
    where: { id },
    data: { status: "BEZAHLT", paidAt: new Date(), paymentRef: ref ?? null },
  });
}

export async function markUnpaid(id: string) {
  return prisma.invoice.update({
    where: { id },
    data: { status: "OFFEN", paidAt: null },
  });
}

export async function recordReminder(id: string) {
  return prisma.invoice.update({
    where: { id },
    data: { remindersSent: { increment: 1 }, lastReminderAt: new Date() },
  });
}

export async function listForCompany(companyId: string) {
  const rows = await prisma.invoice.findMany({ where: { companyId }, orderBy: { monthKey: "desc" } });
  return rows.map(invoiceDTO);
}

export async function listAll(opts: { status?: string; overdueOnly?: boolean } = {}) {
  const where: any = {};
  if (opts.status) where.status = opts.status;
  const rows = await prisma.invoice.findMany({
    where,
    orderBy: [{ monthKey: "desc" }, { invoiceNo: "asc" }],
    include: { company: { select: { name: true, slug: true, email: true } } },
  });
  let dtos = rows.map(invoiceDTO);
  if (opts.overdueOnly) dtos = dtos.filter((d) => d.overdue);
  return dtos;
}
