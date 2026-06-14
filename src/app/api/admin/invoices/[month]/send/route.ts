import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { buildInvoice, parseMonth } from "@/lib/invoice";
import { sendInvoiceEmail } from "@/lib/invoiceMail";

export const dynamic = "force-dynamic";

/**
 * Eigene Monatsrechnung per E-Mail an die Firmen-Adresse senden (Phase 5).
 * Firmen-Admin only. Ohne RESEND_API_KEY -> Mock (kein echter Versand).
 */
export async function POST(_req: Request, { params }: { params: { month: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  if (!parseMonth(params.month)) {
    return NextResponse.json({ error: "Ungültiger Monat (erwartet YYYY-MM)" }, { status: 400 });
  }

  const data = await buildInvoice(session.companyId, params.month);
  if (!data) return NextResponse.json({ error: "Rechnung nicht gefunden" }, { status: 404 });

  const result = await sendInvoiceEmail(data);
  return NextResponse.json({ ok: result.sent, mock: result.mock, to: result.email, error: result.error });
}
