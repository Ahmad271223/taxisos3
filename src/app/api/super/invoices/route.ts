import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { parseMonth } from "@/lib/invoice";
import { issueInvoice, listAll, invoiceToData, recordReminder } from "@/lib/invoiceStore";
import { sendInvoiceEmail } from "@/lib/invoiceMail";

export const dynamic = "force-dynamic";

/** Plattformweites Rechnungs-Archiv (Phase 6, Super-Admin). */
export async function GET(req: Request) {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const overdueOnly = url.searchParams.get("overdue") === "1";
  const invoices = await listAll({ status, overdueOnly });

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const totals = {
    count: invoices.length,
    open: r2(invoices.filter((i) => i.status === "OFFEN").reduce((s, i) => s + i.gross, 0)),
    paid: r2(invoices.filter((i) => i.status === "BEZAHLT").reduce((s, i) => s + i.gross, 0)),
    overdue: r2(invoices.filter((i) => i.overdue).reduce((s, i) => s + i.gross, 0)),
    overdueCount: invoices.filter((i) => i.overdue).length,
  };
  return NextResponse.json({ invoices, totals });
}

/**
 * Sammel-Aktionen (Super-Admin):
 *  { action: "issue-all", month } -> alle Firmen mit abrechenbaren Fahrten festschreiben
 *  { action: "remind-overdue" }   -> Mahnung an alle überfälligen offenen Rechnungen
 */
export async function POST(req: Request) {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* leerer Body erlaubt */
  }
  const action = body?.action;

  if (action === "issue-all") {
    if (!parseMonth(body.month ?? "")) {
      return NextResponse.json({ error: "Ungültiger Monat (erwartet YYYY-MM)" }, { status: 400 });
    }
    const companies = await prisma.company.findMany({ where: { slug: { not: "_super" } }, select: { id: true } });
    let issued = 0;
    let existing = 0;
    let skipped = 0;
    for (const c of companies) {
      const r = await issueInvoice(c.id, body.month);
      if (!r.ok) skipped++;
      else if (r.created) issued++;
      else existing++;
    }
    return NextResponse.json({ ok: true, action, month: body.month, companies: companies.length, issued, existing, skipped });
  }

  if (action === "remind-overdue") {
    const overdue = await listAll({ status: "OFFEN", overdueOnly: true });
    const results = [];
    for (const dto of overdue) {
      const inv = await prisma.invoice.findUnique({ where: { id: dto.id } });
      if (!inv) continue;
      const mail = await sendInvoiceEmail(invoiceToData(inv), { reminder: true, level: inv.remindersSent + 1 });
      if (mail.sent) await recordReminder(inv.id);
      results.push({ invoiceNo: inv.invoiceNo, company: dto.company?.name, sent: mail.sent, mock: mail.mock });
    }
    return NextResponse.json({
      ok: true,
      action,
      reminded: results.filter((r) => r.sent).length,
      attempted: results.length,
      mock: results.length > 0 && results.every((r) => r.mock),
      results,
    });
  }

  return NextResponse.json({ error: "Unbekannte Aktion" }, { status: 400 });
}
