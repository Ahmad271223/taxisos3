import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireRole } from "@/lib/session";
import { buildAllInvoices, parseMonth, type InvoiceData } from "@/lib/invoice";
import { invoicePdf } from "@/lib/pdf";

export const dynamic = "force-dynamic";

function summaryRow(d: InvoiceData) {
  return {
    slug: d.recipient.slug,
    company: d.recipient.name,
    email: d.recipient.email,
    cityTier: d.recipient.cityTier,
    trips: d.trips,
    net: d.net,
    vat: d.vat,
    gross: d.gross,
  };
}

function buildCsv(invoices: InvoiceData[]): string {
  const head = "Firma;Slug;Tarifstufe;Fahrten;Netto;USt;Brutto;EMail";
  const rows = invoices.map((d) =>
    [d.recipient.name, d.recipient.slug, d.recipient.cityTier, d.trips, d.net, d.vat, d.gross, d.recipient.email]
      .map((v) => String(v).replace(/;/g, ","))
      .join(";"),
  );
  // BOM, damit Excel die Umlaute korrekt liest.
  return "﻿" + [head, ...rows].join("\r\n") + "\r\n";
}

/**
 * Sammel-Abrechnung aller Mandanten fuer einen Monat (Phase 5, Super-Admin).
 *  GET /api/super/invoices/<YYYY-MM>              -> ZIP (PDFs je Firma + uebersicht.csv)
 *  GET /api/super/invoices/<YYYY-MM>?format=json  -> Vorschau-Liste (alle Firmen)
 */
export async function GET(req: Request, { params }: { params: { month: string } }) {
  const session = requireRole("SUPER_ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  if (!parseMonth(params.month)) {
    return NextResponse.json({ error: "Ungültiger Monat (erwartet YYYY-MM)" }, { status: 400 });
  }

  const invoices = await buildAllInvoices(params.month);
  const billable = invoices.filter((d) => d.net > 0);

  if (new URL(req.url).searchParams.get("format") === "json") {
    return NextResponse.json({
      month: params.month,
      companies: invoices.length,
      billable: billable.length,
      totals: {
        net: Math.round(invoices.reduce((s, d) => s + d.net, 0) * 100) / 100,
        vat: Math.round(invoices.reduce((s, d) => s + d.vat, 0) * 100) / 100,
        gross: Math.round(invoices.reduce((s, d) => s + d.gross, 0) * 100) / 100,
      },
      rows: invoices.map(summaryRow),
    });
  }

  const zip = new JSZip();
  zip.file(`uebersicht-${params.month}.csv`, buildCsv(invoices));
  for (const d of billable) {
    const pdf = await invoicePdf(d);
    zip.file(`Provisionsrechnung-${d.recipient.slug}-${d.monthKey}.pdf`, pdf);
  }
  const zipBytes = await zip.generateAsync({ type: "uint8array" });
  const buf = Buffer.from(zipBytes);

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="Sammelabrechnung-${params.month}.zip"`,
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
    },
  });
}
