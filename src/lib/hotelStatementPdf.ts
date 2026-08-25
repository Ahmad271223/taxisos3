// PDF der Hotel-Monatsabrechnung (Charge-to-Room / Firmenkonto).
//
// EINE RECHNUNG JE TAXIUNTERNEHMEN: Aussteller ist das Unternehmen, das die
// Fahrten erbracht hat – nicht die Plattform. Der Fahrpreis geht zu 100 % ans
// Unternehmen; eine Sammelrechnung im Namen der Plattform waere falsch.
//
// Ausserdem behoben: Die Strecke (`route`) war im Datenmodell vorhanden, wurde
// aber nie gedruckt – die Buchhaltung des Hotels sah nicht, wofuer der Betrag
// angefallen ist. Folgeseiten tragen jetzt Aussteller, Zeitraum und Seitenzahl.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { safe } from "./pdf";
import { platformFooter } from "./platformIssuer";

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
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

export interface HotelStatementLine {
  date: string;
  guest: string;
  room: string;
  mode: string;
  route: string;
  fare: number;
  companyName?: string | null;
  distanceMeters?: number | null;
}

export interface HotelCarrier {
  id: string;
  name: string;
  address: string | null;
  taxId: string | null;
  vatId: string | null;
}

export interface HotelStatement {
  hotelName: string;
  hotelAddress?: string | null;
  periodLabel: string;
  monthKey?: string;
  issuedAtIso?: string;
  lines: HotelStatementLine[];
  total: number;
  /** Abschnitte je Taxiunternehmen; leer = alte Aufrufform (eine Aufstellung). */
  sections?: { carrier: HotelCarrier | null; lines: HotelStatementLine[]; total: number; vat: { rate: number; gross: number; net: number; tax: number }[] }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function hotelStatementPdf(s: HotelStatement): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Hotel-Abrechnung ${s.periodLabel} – ${s.hotelName}`);
  doc.setProducer("TaxiOS");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const issued = s.issuedAtIso ?? new Date().toISOString();

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  const seitenAussteller = new Map<number, string>();
  let aktuellerAussteller = "";

  const text = (t: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(safe(t), { x, y: yy, size, font: f, color });
  const right = (t: string, rx: number, yy: number, size: number, f: PDFFont = font, color = INK) => {
    const v = safe(t);
    page.drawText(v, { x: rx - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color });
  };
  const hline = (yy: number, color = LINE) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: RIGHT, y: yy }, thickness: 1, color });

  const neueSeite = () => {
    page = doc.addPage(A4);
    y = A4[1] - M;
    seitenAussteller.set(doc.getPageCount() - 1, aktuellerAussteller);
  };

  const clip = (s0: string, max: number, size = 9): string => {
    let v = safe(s0);
    if (font.widthOfTextAtSize(v, size) <= max) return v;
    while (v.length > 4 && font.widthOfTextAtSize(v + "...", size) > max) v = v.slice(0, -1);
    return v + "...";
  };

  // Spalten inkl. Strecke – das war der fehlende Nachweis fuer die Buchhaltung.
  const COL = { date: M, guest: M + 58, room: M + 150, route: M + 196, amount: RIGHT };
  const kopfzeile = () => {
    text("Datum", COL.date, y, 8.5, bold, MUTED);
    text("Gast", COL.guest, y, 8.5, bold, MUTED);
    text("Zimmer", COL.room, y, 8.5, bold, MUTED);
    text("Fahrt", COL.route, y, 8.5, bold, MUTED);
    right("Betrag", COL.amount, y, 8.5, bold, MUTED);
    y -= 6; hline(y); y -= 14;
  };
  const fortsetzung = () => {
    text(aktuellerAussteller, M, y, 11, bold);
    right(`Hotel-Fahrten · ${s.periodLabel} · Fortsetzung`, RIGHT, y, 9, font, MUTED);
    y -= 10; hline(y); y -= 16;
  };

  const ROW = 15;
  const BOTTOM = 120;

  const abschnitt = (
    carrier: HotelCarrier | null,
    lines: HotelStatementLine[],
    total: number,
    vat: { rate: number; gross: number; net: number; tax: number }[],
    erste: boolean,
  ) => {
    aktuellerAussteller = carrier?.name ?? "Taxiunternehmen";
    if (!erste) neueSeite();
    else seitenAussteller.set(doc.getPageCount() - 1, aktuellerAussteller);

    page.drawRectangle({ x: M, y: y - 4, width: 26, height: 26, color: BRAND });
    text(aktuellerAussteller.slice(0, 2).toUpperCase(), M + 5, y + 2, 13, bold);
    text(aktuellerAussteller, M + 34, y + 4, 15, bold);
    if (carrier?.address) text(carrier.address, M + 34, y - 9, 9, font, MUTED);
    const steuer = [
      carrier?.taxId ? `St.-Nr. ${carrier.taxId}` : null,
      carrier?.vatId ? `USt-IdNr. ${carrier.vatId}` : null,
    ].filter(Boolean).join("  ·  ");
    if (steuer) text(steuer, M + 34, y - 21, 8.5, font, MUTED);

    right(carrier ? "RECHNUNG" : "AUFSTELLUNG", RIGHT, y + 2, 20, bold, INK);
    right("Hotel-Fahrten", RIGHT, y - 14, 10, font, MUTED);
    if (carrier && s.monthKey) {
      right(`Rechnungs-Nr. HT-${s.monthKey.replace("-", "")}-${carrier.id.slice(-4).toUpperCase()}`, RIGHT, y - 27, 9.5, font, MUTED);
    }
    right(`Rechnungsdatum: ${dmy(issued)}  ·  Zeitraum: ${s.periodLabel}`, RIGHT, y - 40, 9, font, MUTED);

    y -= 76;
    text("RECHNUNG AN", M, y, 8, bold, MUTED);
    y -= 15;
    text(s.hotelName, M, y, 12, bold);
    if (s.hotelAddress) { y -= 14; text(s.hotelAddress, M, y, 10, font, MUTED); }
    y -= 20;
    text(`Aufs Zimmer bzw. Firmenkonto gebuchte Fahrten im Zeitraum ${s.periodLabel}.`, M, y, 9.5, font, INK);
    y -= 22;

    kopfzeile();
    if (lines.length === 0) { text("Keine Fahrten in diesem Zeitraum.", COL.date, y, 10, font, MUTED); y -= ROW; }
    for (const l of lines) {
      if (y < BOTTOM) { neueSeite(); fortsetzung(); kopfzeile(); }
      text(dmy(l.date), COL.date, y, 9, font);
      text(clip(l.guest, COL.room - COL.guest - 6), COL.guest, y, 9, font);
      text(clip(l.room || "-", COL.route - COL.room - 6), COL.room, y, 9, font);
      text(clip(l.route, COL.amount - COL.route - 62), COL.route, y, 9, font);
      right(eur(l.fare), COL.amount, y, 9, font);
      y -= ROW;
    }

    if (y < BOTTOM + 80) { neueSeite(); fortsetzung(); }
    y -= 4; hline(y); y -= 20;
    const labelX = 320;
    for (const v of vat) {
      text(`Nettobetrag (USt ${Math.round(v.rate * 100)} %)`, labelX, y, 10, font, MUTED);
      right(eur(v.net), RIGHT, y, 10, font);
      y -= 14;
      text(`USt ${Math.round(v.rate * 100)} %`, labelX, y, 10, font, MUTED);
      right(eur(v.tax), RIGHT, y, 10, font);
      y -= 16;
    }
    y -= 2; hline(y); y -= 18;
    text(carrier ? "Rechnungsbetrag" : "Gesamt", labelX, y, 12, bold);
    right(eur(total), RIGHT, y, 12, bold);
    y -= 22;
    if (carrier) {
      const ziel = new Date(new Date(issued).getTime() + 14 * 24 * 3600 * 1000);
      text(`Zahlbar ohne Abzug bis ${dmy(ziel.toISOString())}. Leistung: Personenbeförderung für Hotelgäste.`, M, y, 9, font, MUTED);
      y -= 13;
      if (!carrier.taxId && !carrier.vatId) {
        text("Hinweis: Steuernummer des Ausstellers noch nicht hinterlegt – bitte im Unternehmensprofil ergänzen.", M, y, 8.5, font, MUTED);
        y -= 13;
      }
    }
  };

  const abschnitte = s.sections?.length
    ? s.sections
    : [{ carrier: null, lines: s.lines, total: s.total, vat: [] as { rate: number; gross: number; net: number; tax: number }[] }];
  abschnitte.forEach((a, i) => abschnitt(a.carrier, a.lines, a.total, a.vat, i === 0));

  // Fusszeile mit Identitaet + Seitenzahl auf JEDER Seite.
  const gesamt = doc.getPageCount();
  doc.getPages().forEach((p, i) => {
    const fuss = `${seitenAussteller.get(i) ?? ""} · ${s.hotelName} · ${s.periodLabel} · Seite ${i + 1} von ${gesamt} · ${platformFooter()}`;
    p.drawLine({ start: { x: M, y: 58 }, end: { x: RIGHT, y: 58 }, thickness: 1, color: LINE });
    p.drawText(safe(fuss), { x: M, y: 44, size: 8, font, color: MUTED });
  });

  return doc.save();
}

/** Gruppiert Zeilen je Unternehmen und rechnet den USt-Ausweis aus. */
export function hotelSections(
  lines: HotelStatementLine[],
  carriers: Map<string, HotelCarrier>,
  vatRate: (m?: number | null) => number,
): NonNullable<HotelStatement["sections"]> {
  const map = new Map<string, HotelStatementLine[]>();
  for (const l of lines) {
    const key = l.companyName ?? "__offen__";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, sl]) => {
      const summe = new Map<number, number>();
      for (const l of sl) {
        const r = vatRate(l.distanceMeters);
        summe.set(r, (summe.get(r) ?? 0) + l.fare);
      }
      return {
        carrier: carriers.get(key) ?? null,
        lines: sl,
        total: round2(sl.reduce((s, l) => s + l.fare, 0)),
        vat: [...summe.entries()].sort(([a], [b]) => a - b).map(([rate, gross]) => {
          const net = round2(gross / (1 + rate));
          return { rate, gross: round2(gross), net, tax: round2(gross - net) };
        }),
      };
    });
}
