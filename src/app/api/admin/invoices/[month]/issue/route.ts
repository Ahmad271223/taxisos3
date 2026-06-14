import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { parseMonth } from "@/lib/invoice";
import { issueInvoice, invoiceDTO } from "@/lib/invoiceStore";

export const dynamic = "force-dynamic";

/**
 * Rechnung festschreiben (Phase 6). Idempotent: existiert bereits eine Rechnung
 * für Firma+Monat, wird sie unverändert geliefert (created=false).
 * Firmen-Admin: eigene Firma; Super-Admin: via ?companyId=.
 */
export async function POST(req: Request, { params }: { params: { month: string } }) {
  const session = getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }
  let companyId = session.companyId;
  const q = new URL(req.url).searchParams.get("companyId");
  if (session.role === "SUPER_ADMIN") {
    if (!q) return NextResponse.json({ error: "companyId erforderlich" }, { status: 400 });
    companyId = q;
  } else if (q && q !== session.companyId) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }
  if (!parseMonth(params.month)) {
    return NextResponse.json({ error: "Ungültiger Monat (erwartet YYYY-MM)" }, { status: 400 });
  }

  const r = await issueInvoice(companyId, params.month);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, created: r.created, invoice: invoiceDTO(r.invoice) });
}
