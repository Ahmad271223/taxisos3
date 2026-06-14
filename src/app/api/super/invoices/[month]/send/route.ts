import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { buildAllInvoices, parseMonth } from "@/lib/invoice";
import { sendInvoiceEmail } from "@/lib/invoiceMail";

export const dynamic = "force-dynamic";

/**
 * Sammel-Versand (Phase 5, Super-Admin): verschickt an jede Firma mit
 * Provision > 0 ihre Monatsrechnung als E-Mail (Resend) mit PDF-Anhang.
 * Ohne RESEND_API_KEY -> Mock (kein echter Versand, results.mock=true).
 */
export async function POST(_req: Request, { params }: { params: { month: string } }) {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  if (!parseMonth(params.month)) {
    return NextResponse.json({ error: "Ungültiger Monat (erwartet YYYY-MM)" }, { status: 400 });
  }

  const invoices = (await buildAllInvoices(params.month)).filter((d) => d.net > 0);
  const results = [];
  for (const d of invoices) {
    results.push(await sendInvoiceEmail(d));
  }

  return NextResponse.json({
    month: params.month,
    attempted: results.length,
    sent: results.filter((r) => r.sent).length,
    failed: results.filter((r) => !r.sent).length,
    mock: results.length > 0 && results.every((r) => r.mock),
    results,
  });
}
