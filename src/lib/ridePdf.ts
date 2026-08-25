// Fahrtbeleg/Quittung für den Kunden (Phase 19) mit pdf-lib.
//
// AUSSTELLER IST DAS TAXIUNTERNEHMEN, nicht die Plattform. Die
// Beförderungsleistung erbringt das Unternehmen, und der Fahrpreis geht zu
// 100 % dorthin – ein Beleg im Namen von "TaxiOS" wäre schlicht falsch und
// für die Buchhaltung des Fahrgasts unbrauchbar. Die Plattform erscheint nur
// noch als Vermittlungshinweis in der Fußzeile.
//
// Für einen als Kleinbetragsrechnung (§ 33 UStDV) verwendbaren Beleg gehören
// Name UND Anschrift des Beförderers auf das Dokument; Steuernummer bzw.
// USt-IdNr. werden gedruckt, sobald das Unternehmen sie hinterlegt hat.
//
// USt-Satz: 7 % für Taxiverkehr bis 50 km Beförderungsstrecke, sonst 19 %
// (§ 12 Abs. 2 Nr. 10 UStG). Grundlage ist die gespeicherte Routenstrecke.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { safe } from "./pdf";
import { platformFooter } from "./platformIssuer";

export interface RideReceiptData {
  receiptNo: string;
  dateIso: string;
  customerName: string;
  pickup: string;
  dest: string;
  stops?: string[];
  vehicleClassLabel: string;
  distanceMeters?: number | null;
  fare: number;
  tip?: number | null;
  paymentMethod: string; // CASH | CARD | FIRMA
  paymentStatus: string;
  // Beförderer = ausstellendes Taxiunternehmen.
  carrier?: string | null;
  carrierAddress?: string | null;
  carrierPhone?: string | null;
  carrierEmail?: string | null;
  carrierTaxId?: string | null; // Steuernummer
  carrierVatId?: string | null; // USt-IdNr.
  driverName?: string | null;
  plate?: string | null;
}

const A4: [number, number] = [595.28, 841.89];
const M = 50;
const RIGHT = A4[0] - M;
const INK = rgb(0.07, 0.09, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const BRAND = rgb(1, 0.77, 0);
const LINE = rgb(0.85, 0.86, 0.88);

function eur(n: number): string {
  return `${(n ?? 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}
function dmy(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** USt-Satz fuer Taxiverkehr: 7 % bis 50 km Befoerderungsstrecke, sonst 19 %. */
export function taxiVatRate(distanceMeters?: number | null): number {
  if (distanceMeters != null && distanceMeters > 50_000) return 0.19;
  return 0.07;
}

export async function rideReceiptPdf(d: RideReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Fahrtbeleg ${d.receiptNo}`);
  doc.setProducer("TaxiOS");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;

  const text = (t: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(safe(t), { x, y: yy, size, font: f, color });
  const right = (t: string, rx: number, yy: number, size: number, f: PDFFont = font, color = INK) => {
    const s = safe(t);
    page.drawText(s, { x: rx - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color });
  };
  const hline = (yy: number, color = LINE) => page.drawLine({ start: { x: M, y: yy }, end: { x: RIGHT, y: yy }, thickness: 1, color });

  // Kopf: AUSSTELLER = Taxiunternehmen.
  const aussteller = d.carrier?.trim() || "Taxiunternehmen";
  page.drawRectangle({ x: M, y: y - 4, width: 26, height: 26, color: BRAND });
  text(aussteller.slice(0, 2).toUpperCase(), M + 5, y + 2, 13, bold);
  text(aussteller, M + 34, y + 4, 15, bold);
  if (d.carrierAddress) text(d.carrierAddress, M + 34, y - 9, 9, font, MUTED);
  const steuerzeile = [
    d.carrierTaxId ? `St.-Nr. ${d.carrierTaxId}` : null,
    d.carrierVatId ? `USt-IdNr. ${d.carrierVatId}` : null,
    d.carrierPhone ?? null,
  ].filter(Boolean).join("  ·  ");
  if (steuerzeile) text(steuerzeile, M + 34, y - 21, 8.5, font, MUTED);

  right("FAHRTBELEG", RIGHT, y + 2, 18, bold, INK);
  right(`Nr. ${d.receiptNo}`, RIGHT, y - 14, 10, font, MUTED);
  right(`Datum: ${dmy(d.dateIso)}`, RIGHT, y - 27, 10, font, MUTED);

  y -= 72;
  text("BELEG FÜR", M, y, 8, bold, MUTED);
  y -= 15;
  text(d.customerName || "Kunde", M, y, 12, bold);

  y -= 30;
  hline(y);
  y -= 20;

  // Fahrtdetails
  const row = (label: string, value: string) => {
    text(label, M, y, 9, bold, MUTED);
    text(value, M + 130, y, 10, font, INK);
    y -= 18;
  };
  row("Abholung", d.pickup);
  (d.stops ?? []).forEach((s, i) => row(`Zwischenstopp ${i + 1}`, s));
  row("Ziel", d.dest);
  row("Fahrzeug", d.vehicleClassLabel);
  if (d.driverName) row("Fahrer", `${d.driverName}${d.plate ? " · " + d.plate : ""}`);
  if (d.distanceMeters != null) row("Strecke", `${(d.distanceMeters / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} km`);
  row("Zahlart", d.paymentMethod === "CARD" ? "Karte" : d.paymentMethod === "FIRMA" ? "Firmenkonto" : "Barzahlung");

  // Summe: USt-Satz haengt von der Strecke ab (7 % bis 50 km, sonst 19 %).
  const rate = taxiVatRate(d.distanceMeters);
  const ratePct = Math.round(rate * 100);
  const tip = Math.round(((d.tip ?? 0) as number) * 100) / 100;
  const brutto = Math.round((d.fare + tip) * 100) / 100;
  // Trinkgeld ist freiwillig und kein Entgeltbestandteil -> USt nur auf den Fahrpreis.
  const net = Math.round((d.fare / (1 + rate)) * 100) / 100;
  const vat = Math.round((d.fare - net) * 100) / 100;

  y -= 6;
  hline(y);
  y -= 20;
  const labelX = 360;
  text("Fahrpreis (brutto)", labelX, y, 10, font, MUTED);
  right(eur(d.fare), RIGHT, y, 10, font);
  y -= 16;
  text(`darin enthaltene USt ${ratePct} %`, labelX, y, 10, font, MUTED);
  right(eur(vat), RIGHT, y, 10, font);
  y -= 16;
  text("Nettobetrag", labelX, y, 10, font, MUTED);
  right(eur(net), RIGHT, y, 10, font);
  if (tip > 0) {
    y -= 16;
    text("Trinkgeld (freiwillig)", labelX, y, 10, font, MUTED);
    right(eur(tip), RIGHT, y, 10, font);
  }
  y -= 8;
  hline(y);
  y -= 18;
  text("Gesamtbetrag", labelX, y, 13, bold);
  right(eur(brutto), RIGHT, y, 13, bold);

  // Fuss: Vermittlungshinweis statt Plattform-Absender.
  let fy = 96;
  hline(fy + 12);
  text(`Vielen Dank für Ihre Fahrt mit ${aussteller}.`, M, fy, 9, font, MUTED);
  fy -= 12;
  text(`Personenbeförderung im Taxiverkehr · USt-Satz ${ratePct} %${d.distanceMeters == null ? " (Strecke bis 50 km angenommen)" : ""}.`, M, fy, 8.5, font, MUTED);
  fy -= 12;
  if (!d.carrierTaxId && !d.carrierVatId) {
    text("Hinweis: Ohne Steuernummer des Beförderers gilt dieser Beleg nicht als Kleinbetragsrechnung nach § 33 UStDV.", M, fy, 8, font, MUTED);
    fy -= 12;
  }
  text(`${platformFooter()} – die Beförderungsleistung erbringt das oben genannte Taxiunternehmen.`, M, fy, 8, font, MUTED);

  return doc.save();
}
