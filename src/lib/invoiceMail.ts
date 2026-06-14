// Versand der Provisions-Rechnung per E-Mail (Phase 5) – Resend mit PDF-Anhang.
// Ohne RESEND_API_KEY laeuft es im Mock-Modus (nur Log), bleibt also testbar.

import { sendEmail, type SendResult } from "@/lib/notify";
import { invoicePdf } from "@/lib/pdf";
import type { InvoiceData } from "@/lib/invoice";

function eur(n: number): string {
  return `${(n ?? 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

function invoiceHtml(d: InvoiceData): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:560px">
    <h2 style="margin:0 0 4px">Provisions-Rechnung ${d.periodLabel}</h2>
    <p style="margin:0 0 16px;color:#6b7280">Rechnungs-Nr. ${d.invoiceNo}</p>
    <p>Guten Tag ${d.recipient.name},</p>
    <p>anbei Ihre Rechnung über die Vermittlungsgebühren der Plattform für
    <strong>${d.periodLabel}</strong> (${d.trips} abgeschlossene Fahrt(en)).</p>
    <table style="border-collapse:collapse;margin:12px 0">
      <tr><td style="padding:2px 16px 2px 0;color:#6b7280">Zwischensumme (netto)</td><td style="text-align:right"><strong>${eur(d.net)}</strong></td></tr>
      <tr><td style="padding:2px 16px 2px 0;color:#6b7280">zzgl. USt ${Math.round(d.vatRate * 100)} %</td><td style="text-align:right">${eur(d.vat)}</td></tr>
      <tr><td style="padding:6px 16px 2px 0"><strong>Gesamtbetrag</strong></td><td style="text-align:right;border-top:1px solid #e5e7eb;padding-top:6px"><strong>${eur(d.gross)}</strong></td></tr>
    </table>
    <p style="color:#6b7280;font-size:13px">Die vollständige Aufstellung finden Sie im angehängten PDF. Zahlbar innerhalb von 14 Tagen ohne Abzug.</p>
    <p style="color:#9ca3af;font-size:12px">${d.issuer.name} · ${d.issuer.address} · USt-IdNr. ${d.issuer.vatId}</p>
  </div>`;
}

export interface InvoiceMailResult {
  slug: string;
  company: string;
  email: string;
  net: number;
  gross: number;
  sent: boolean;
  mock: boolean;
  error?: string;
}

function reminderHtml(d: InvoiceData, level: number): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:560px">
    <h2 style="margin:0 0 4px;color:#b91c1c">Zahlungserinnerung${level > 1 ? ` (${level}. Mahnung)` : ""}</h2>
    <p style="margin:0 0 16px;color:#6b7280">Rechnungs-Nr. ${d.invoiceNo} · ${d.periodLabel}</p>
    <p>Guten Tag ${d.recipient.name},</p>
    <p>unsere Rechnung über die Vermittlungsgebühren für <strong>${d.periodLabel}</strong> über
    <strong>${eur(d.gross)}</strong> ist noch offen. Bitte begleichen Sie den Betrag zeitnah.</p>
    <p style="color:#6b7280;font-size:13px">Die Rechnung finden Sie erneut im Anhang. Sollte sich Ihre Zahlung überschnitten haben, betrachten Sie dieses Schreiben als gegenstandslos.</p>
    <p style="color:#9ca3af;font-size:12px">${d.issuer.name} · ${d.issuer.address} · USt-IdNr. ${d.issuer.vatId}</p>
  </div>`;
}

// Eine einzelne Rechnung als E-Mail mit PDF-Anhang versenden.
// opts.reminder=true -> Mahnungs-Text + Mahn-Betreff.
export async function sendInvoiceEmail(
  d: InvoiceData,
  opts: { reminder?: boolean; level?: number } = {},
): Promise<InvoiceMailResult> {
  let res: SendResult;
  try {
    const pdf = await invoicePdf(d);
    const level = opts.level ?? 1;
    const subject = opts.reminder
      ? `Zahlungserinnerung – Provisionsrechnung ${d.periodLabel} (${d.invoiceNo})`
      : `Provisionsrechnung ${d.periodLabel} – ${d.invoiceNo}`;
    res = await sendEmail(
      d.recipient.email,
      subject,
      opts.reminder ? reminderHtml(d, level) : invoiceHtml(d),
      [{ filename: `Provisionsrechnung-${d.monthKey}.pdf`, content: Buffer.from(pdf) }],
    );
  } catch (e: any) {
    res = { ok: false, mock: false, error: e?.message ?? "pdf_error" };
  }
  return {
    slug: d.recipient.slug,
    company: d.recipient.name,
    email: d.recipient.email,
    net: d.net,
    gross: d.gross,
    sent: res.ok,
    mock: res.mock,
    error: res.error,
  };
}
