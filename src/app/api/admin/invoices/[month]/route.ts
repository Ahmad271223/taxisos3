import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { buildInvoice, parseMonth } from "@/lib/invoice";
import { invoicePdf } from "@/lib/pdf";

import { invoiceModuleRetired } from "@/lib/invoiceRetired";
export const dynamic = "force-dynamic";

/**
 * Monatliche Provisions-Rechnung (Phase 4).
 *  GET /api/admin/invoices/<YYYY-MM>            -> PDF-Download
 *  GET /api/admin/invoices/<YYYY-MM>?format=json -> Vorschau-Daten (JSON)
 *
 * Firmen-Admin: nur die eigene Firma. Super-Admin: beliebige Firma via ?companyId=.
 */
export async function GET(req: Request, { params }: { params: { month: string } }) {
  // Diese Route erzeugt die Provisions-Rechnung als PDF. Ohne Provision waere
  // das eine Rechnung ueber 0,00 EUR – siehe lib/invoiceRetired.ts.
  // Die Umsatzuebersicht liefert sie weiterhin ueber ?format=json.
  const url0 = new URL(req.url);
  if (url0.searchParams.get("format") !== "json") {
    const gesperrt = invoiceModuleRetired();
    if (gesperrt) return gesperrt;
  }
  const session = getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const url = new URL(req.url);
  const qCompany = url.searchParams.get("companyId");
  let companyId = session.companyId;
  if (session.role === "SUPER_ADMIN") {
    if (!qCompany) {
      return NextResponse.json({ error: "companyId erforderlich" }, { status: 400 });
    }
    companyId = qCompany;
  } else if (qCompany && qCompany !== session.companyId) {
    return NextResponse.json({ error: "Zugriff verweigert" }, { status: 403 });
  }

  if (!parseMonth(params.month)) {
    return NextResponse.json({ error: "Ungültiger Monat (erwartet YYYY-MM)" }, { status: 400 });
  }

  const data = await buildInvoice(companyId, params.month);
  if (!data) {
    return NextResponse.json({ error: "Rechnung konnte nicht erstellt werden" }, { status: 404 });
  }

  if (url.searchParams.get("format") === "json") {
    return NextResponse.json(data);
  }

  const pdf = await invoicePdf(data);
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Provisionsrechnung-${data.monthKey}.pdf"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "no-store",
    },
  });
}
