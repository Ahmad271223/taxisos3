// PDF der Hotel-Monatsabrechnung (Charge-to-Room / Firmenkonto), im Stil der
// Firmenmobilitäts-/Einrichtungs-Abrechnung (lib/corporatePdf.ts).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

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
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

export interface HotelStatementLine {
  date: string;
  guest: string;
  room: string;
  mode: string;
  route: string;
  fare: number;
}
export interface HotelStatement {
  hotelName: string;
  periodLabel: string;
  lines: HotelStatementLine[];
  total: number;
}

export async function hotelStatementPdf(s: HotelStatement): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Hotel-Abrechnung ${s.periodLabel} – ${s.hotelName}`);
  doc.setProducer("TaxiOS");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const platformName = process.env.PLATFORM_NAME ?? "TaxiOS Plattform GmbH";
  const platformAddr = process.env.PLATFORM_ADDRESS ?? "";

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const text = (t: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(safe(t), { x, y: yy, size, font: f, color });
  const right = (t: string, rx: number, yy: number, size: number, f: PDFFont = font, color = INK) => {
    const v = safe(t);
    page.drawText(v, { x: rx - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color });
  };
  const hline = (yy: number, color = LINE) => page.drawLine({ start: { x: M, y: yy }, end: { x: RIGHT, y: yy }, thickness: 1, color });

  page.drawRectangle({ x: M, y: y - 4, width: 26, height: 26, color: BRAND });
  text("TX", M + 5, y + 2, 14, bold);
  text(platformName, M + 34, y + 4, 15, bold);
  if (platformAddr) text(platformAddr, M + 34, y - 9, 9, font, MUTED);
  right("ABRECHNUNG", RIGHT, y + 2, 20, bold, INK);
  right("Hotel-Fahrten", RIGHT, y - 14, 10, font, MUTED);
  right(`Zeitraum: ${s.periodLabel}`, RIGHT, y - 27, 10, font, MUTED);
  y -= 64;

  text("HOTEL", M, y, 8, bold, MUTED);
  y -= 15;
  text(s.hotelName, M, y, 12, bold);
  right("Fahrten gesamt", RIGHT, y + 15, 8, bold, MUTED);
  right(String(s.lines.length), RIGHT, y, 13, bold);
  y -= 26;
  text(`Aufs Zimmer / Firmenkonto gebuchte Fahrten im Zeitraum ${s.periodLabel}.`, M, y, 9.5, font, INK);
  y -= 22;

  const COL = { date: M, guest: M + 62, room: M + 175, mode: M + 230, amount: RIGHT };
  const drawHeader = () => {
    text("Datum", COL.date, y, 8.5, bold, MUTED);
    text("Gast", COL.guest, y, 8.5, bold, MUTED);
    text("Zimmer", COL.room, y, 8.5, bold, MUTED);
    text("Abrechnung", COL.mode, y, 8.5, bold, MUTED);
    right("Betrag", COL.amount, y, 8.5, bold, MUTED);
    y -= 6; hline(y); y -= 14;
  };
  drawHeader();
  const ROW = 15;
  const BOTTOM = 110;
  const clip = (s0: string, max: number, size = 9): string => {
    let v = safe(s0);
    if (font.widthOfTextAtSize(v, size) <= max) return v;
    while (v.length > 4 && font.widthOfTextAtSize(v + "...", size) > max) v = v.slice(0, -1);
    return v + "...";
  };
  if (s.lines.length === 0) { text("Keine Fahrten in diesem Zeitraum.", COL.date, y, 10, font, MUTED); y -= ROW; }
  for (const l of s.lines) {
    if (y < BOTTOM) { page = doc.addPage(A4); y = A4[1] - M; drawHeader(); }
    text(dmy(l.date), COL.date, y, 9, font);
    text(clip(l.guest, COL.room - COL.guest - 6), COL.guest, y, 9, font);
    text(clip(l.room || "-", COL.mode - COL.room - 6), COL.room, y, 9, font);
    text(l.mode, COL.mode, y, 9, font, MUTED);
    right(eur(l.fare), COL.amount, y, 9, font);
    y -= ROW;
  }
  y -= 4; hline(y); y -= 20;
  text("Gesamt", 360, y, 12, bold);
  right(eur(s.total), RIGHT, y, 12, bold);

  let fy = 74;
  hline(fy + 12);
  text("Leistung: Personenbeförderung für Hotelgäste (Charge-to-Room / Firmenkonto).", M, fy, 8.5, font, MUTED);
  fy -= 12;
  text(`${platformName}${platformAddr ? " · " + platformAddr : ""}`, M, fy, 8, font, MUTED);

  return doc.save();
}
