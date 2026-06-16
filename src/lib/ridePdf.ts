// Fahrtbeleg/Quittung für den Kunden (Phase 19) mit pdf-lib.
// WinAnsi-sicher (siehe lib/pdf.ts): "→"->"->", Beträge als "EUR".

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

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
  paymentMethod: string; // CASH | CARD
  paymentStatus: string;
  carrier?: string | null; // Taxiunternehmen
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

function safe(s: string): string {
  return (s ?? "").replace(/→/g, "->").replace(/[^ -ÿ]/g, "?");
}
function eur(n: number): string {
  return `${(n ?? 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}
function dmy(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
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

  // Kopf
  page.drawRectangle({ x: M, y: y - 4, width: 26, height: 26, color: BRAND });
  text("TX", M + 5, y + 2, 14, bold);
  text("TaxiOS", M + 34, y + 4, 15, bold);
  text("Fahrtbeleg / Quittung", M + 34, y - 9, 9, font, MUTED);
  right("FAHRTBELEG", RIGHT, y + 2, 18, bold, INK);
  right(`Nr. ${d.receiptNo}`, RIGHT, y - 14, 10, font, MUTED);
  right(`Datum: ${dmy(d.dateIso)}`, RIGHT, y - 27, 10, font, MUTED);

  y -= 64;
  text("BELEG FÜR", M, y, 8, bold, MUTED);
  y -= 15;
  text(d.customerName || "Kunde", M, y, 12, bold);

  // Beförderer rechts
  if (d.carrier) {
    right("Beförderer", RIGHT, y + 15, 8, bold, MUTED);
    right(d.carrier, RIGHT, y + 1, 10, font, INK);
  }

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

  // Summe (Personenbeförderung: 7 % USt enthalten)
  y -= 6;
  hline(y);
  y -= 20;
  const net = Math.round((d.fare / 1.07) * 100) / 100;
  const vat = Math.round((d.fare - net) * 100) / 100;
  const labelX = 360;
  text("Nettobetrag", labelX, y, 10, font, MUTED);
  right(eur(net), RIGHT, y, 10, font);
  y -= 16;
  text("enthaltene USt 7 %", labelX, y, 10, font, MUTED);
  right(eur(vat), RIGHT, y, 10, font);
  y -= 8;
  hline(y);
  y -= 18;
  text("Gesamtbetrag", labelX, y, 13, bold);
  right(eur(d.fare), RIGHT, y, 13, bold);

  // Fuss
  let fy = 90;
  hline(fy + 12);
  text("Vielen Dank für Ihre Fahrt mit TaxiOS.", M, fy, 9, font, MUTED);
  fy -= 12;
  text("Personenbeförderung im Taxiverkehr · USt-Satz 7 %.", M, fy, 8.5, font, MUTED);

  return doc.save();
}
