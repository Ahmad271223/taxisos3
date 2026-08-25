// PDF der Firmenmobilitäts-Monatsabrechnung (QR-Firmenmobilität) mit pdf-lib,
// im Stil der Einrichtungs- und Hotel-Abrechnung.
//
// AUSSTELLER IST DAS TAXIUNTERNEHMEN, nicht die Plattform. Vorher trat hier
// "TaxiOS Plattform GmbH" als Absender auf und stellte damit Beträge in
// Rechnung, die vollständig an das befördernde Unternehmen gehen. Fährt in
// einem Monat mehr als ein Unternehmen für dieselbe Firma, entsteht je
// Unternehmen ein eigener Rechnungsabschnitt mit eigener Nummer – so ist
// jeder Abschnitt für sich buchbar.
//
// Pflichtangaben wie bei den übrigen Abrechnungen: Anschrift des Ausstellers,
// Steuernummer bzw. USt-IdNr., Rechnungsnummer, Rechnungsdatum, USt-Ausweis
// und Zahlungsziel. Die Plattform erscheint nur noch als Vermittlungshinweis
// in der Fußzeile.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Gemeinsame Umschrift statt lokaler Kopie: Namen wie "Şahin" wurden hier
// sonst zu "?ahin" (jede Datei hatte ihre eigene, alte safe()-Version).
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
function dmy(d: Date): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CorporateStatementLine {
  date: Date;
  guest: string;
  route: string;
  code: string;
  amount: number; // EUR
  /** Beförderndes Unternehmen – bestimmt den Rechnungsabschnitt. */
  companyName?: string | null;
  /** Für den USt-Satz: 7 % bis 50 km, darüber 19 %. */
  distanceMeters?: number | null;
}

export interface CorporateCarrier {
  id: string;
  name: string;
  address: string | null;
  taxId: string | null;
  vatId: string | null;
}

export interface CorporateSection {
  carrier: CorporateCarrier | null;
  invoiceNo: string;
  lines: CorporateStatementLine[];
  total: number;
  vat: { rate: number; gross: number; net: number; tax: number }[];
}

export interface CorporateStatement {
  company: string;
  companyAddress?: string | null;
  periodLabel: string;
  monthKey?: string;
  issuedAtIso?: string;
  lines: CorporateStatementLine[];
  total: number;
  /** Abschnitte je Taxiunternehmen; fehlt sie, wird eine einfache Aufstellung gedruckt. */
  sections?: CorporateSection[];
}

export async function corporateStatementPdf(s: CorporateStatement): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Firmenmobilität ${s.periodLabel} – ${s.company}`);
  doc.setProducer("TaxiOS");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const issued = s.issuedAtIso ? new Date(s.issuedAtIso) : new Date();

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;
  // Je Seite merken, wer sie ausgestellt hat – die Fußzeile muss den
  // richtigen Aussteller nennen, auch wenn ein Abschnitt über mehrere
  // Seiten läuft.
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

  const merkeSeite = () => seitenAussteller.set(doc.getPageCount() - 1, aktuellerAussteller);

  const neueSeite = () => {
    page = doc.addPage(A4);
    y = A4[1] - M;
    merkeSeite();
  };

  const clip = (s0: string, max: number, size = 9): string => {
    let v = safe(s0);
    if (font.widthOfTextAtSize(v, size) <= max) return v;
    while (v.length > 4 && font.widthOfTextAtSize(v + "...", size) > max) v = v.slice(0, -1);
    return v + "...";
  };

  // Bei Fahrten ist das ZIEL die entscheidende Angabe. Wird von hinten
  // gekürzt, verschwindet genau sie und übrig bleibt "Hotel Adler → Flugh...".
  // Deshalb vorne kürzen.
  const clipRouteZielErhalten = (route: string, max: number, size = 9): string => {
    let v = safe(route);
    if (font.widthOfTextAtSize(v, size) <= max) return v;
    while (v.length > 4 && font.widthOfTextAtSize("..." + v, size) > max) v = v.slice(1);
    return "..." + v;
  };

  const COL = { date: M, guest: M + 62, route: M + 190, code: 430, amount: RIGHT };
  const drawHeader = () => {
    text("Datum", COL.date, y, 8.5, bold, MUTED);
    text("Fahrgast", COL.guest, y, 8.5, bold, MUTED);
    text("Fahrt", COL.route, y, 8.5, bold, MUTED);
    text("Code", COL.code, y, 8.5, bold, MUTED);
    right("Betrag", COL.amount, y, 8.5, bold, MUTED);
    y -= 6; hline(y); y -= 14;
  };

  const ROW = 15;
  const BOTTOM = 130;

  /** Kopf eines Rechnungsabschnitts: Aussteller, Empfänger, Nummer, Datum. */
  const abschnittKopf = (abschnitt: CorporateSection) => {
    const c = abschnitt.carrier;
    aktuellerAussteller = c?.name ?? "Taxiunternehmen";
    merkeSeite();

    page.drawRectangle({ x: M, y: y - 4, width: 26, height: 26, color: BRAND });
    text(aktuellerAussteller.slice(0, 2).toUpperCase(), M + 5, y + 2, 13, bold);
    text(aktuellerAussteller, M + 34, y + 4, 15, bold);
    if (c?.address) text(c.address, M + 34, y - 9, 9, font, MUTED);
    const steuerzeile = [
      c?.taxId ? `St.-Nr. ${c.taxId}` : null,
      c?.vatId ? `USt-IdNr. ${c.vatId}` : null,
    ].filter(Boolean).join("  ·  ");
    if (steuerzeile) text(steuerzeile, M + 34, y - 21, 8.5, font, MUTED);

    right("RECHNUNG", RIGHT, y + 2, 20, bold, INK);
    right(`Nr. ${abschnitt.invoiceNo}`, RIGHT, y - 14, 9.5, font, MUTED);
    right(`Rechnungsdatum: ${dmy(issued)}`, RIGHT, y - 27, 9.5, font, MUTED);
    right(`Zeitraum: ${s.periodLabel}`, RIGHT, y - 40, 9.5, font, MUTED);

    y -= 74;
    text("RECHNUNGSEMPFÄNGER", M, y, 8, bold, MUTED);
    y -= 15;
    text(s.company, M, y, 12, bold);
    if (s.companyAddress) { y -= 13; text(s.companyAddress, M, y, 9, font, MUTED); }

    right("Fahrten", RIGHT, y + 15, 8, bold, MUTED);
    right(String(abschnitt.lines.length), RIGHT, y, 13, bold);

    y -= 26;
    text(
      `Über QR-Firmenmobilität übernommene Fahrten im Zeitraum ${s.periodLabel}.`,
      M, y, 9.5, font, INK,
    );
    y -= 22;
    drawHeader();
  };

  const abschnittFuss = (abschnitt: CorporateSection) => {
    if (y < BOTTOM + 90) neueSeite();
    y -= 4; hline(y); y -= 20;
    text("Gesamt übernommen", 330, y, 12, bold);
    right(eur(abschnitt.total), RIGHT, y, 12, bold);

    for (const v of abschnitt.vat) {
      y -= 16;
      text(`darin enthaltene USt ${Math.round(v.rate * 100)} %`, 330, y, 9.5, font, MUTED);
      right(eur(v.tax), RIGHT, y, 9.5, font, MUTED);
      y -= 14;
      text("Nettobetrag", 330, y, 9.5, font, MUTED);
      right(eur(v.net), RIGHT, y, 9.5, font, MUTED);
    }

    y -= 20;
    text("Zahlbar ohne Abzug innerhalb von 14 Tagen nach Rechnungsdatum.", M, y, 9, font, MUTED);
    y -= 13;
    text(
      "Leistung: Personenbeförderung, übernommen durch das Firmenkonto (QR-Firmenmobilität).",
      M, y, 8.5, font, MUTED,
    );
    if (!abschnitt.carrier?.taxId && !abschnitt.carrier?.vatId) {
      y -= 13;
      text(
        "Hinweis: Steuernummer des Ausstellers noch nicht hinterlegt – bitte im Unternehmensprofil ergänzen.",
        M, y, 8, font, MUTED,
      );
    }
    y -= 30;
  };

  const abschnitte: CorporateSection[] =
    s.sections && s.sections.length
      ? s.sections
      : [{
          carrier: null,
          invoiceNo: rechnungsNummer(s.monthKey ?? "", null, s.company),
          lines: s.lines,
          total: s.total,
          vat: [],
        }];

  abschnitte.forEach((abschnitt, idx) => {
    if (idx > 0) neueSeite();
    abschnittKopf(abschnitt);

    if (abschnitt.lines.length === 0) {
      text("Keine Fahrten in diesem Zeitraum.", COL.date, y, 10, font, MUTED);
      y -= ROW;
    }
    for (const l of abschnitt.lines) {
      if (y < BOTTOM) { neueSeite(); drawHeader(); }
      text(dmy(l.date), COL.date, y, 9, font);
      text(clip(l.guest, COL.route - COL.guest - 8), COL.guest, y, 9, font);
      text(clipRouteZielErhalten(l.route, COL.code - COL.route - 8), COL.route, y, 9, font);
      text(clip(l.code, COL.amount - COL.code - 50), COL.code, y, 9, font, MUTED);
      right(eur(l.amount), COL.amount, y, 9, font);
      y -= ROW;
    }

    abschnittFuss(abschnitt);
  });

  // Fußzeile auf jeder Seite: Aussteller, Empfänger, Seitenzahl, Vermittler.
  const gesamt = doc.getPageCount();
  doc.getPages().forEach((p, i) => {
    const fuss = `${seitenAussteller.get(i) ?? ""} · ${s.company} · ${s.periodLabel} · Seite ${i + 1} von ${gesamt} · ${platformFooter()}`;
    p.drawLine({ start: { x: M, y: 58 }, end: { x: RIGHT, y: 58 }, thickness: 1, color: LINE });
    p.drawText(safe(fuss), { x: M, y: 44, size: 8, font, color: MUTED });
  });

  return doc.save();
}

/** Rechnungsnummer je Abschnitt: Monat + Unternehmen + Empfänger. */
export function rechnungsNummer(monthKey: string, carrierId: string | null, empfaenger: string): string {
  const monat = (monthKey || "").replace("-", "") || "000000";
  const firma = (carrierId ?? "XXXX").slice(-4).toUpperCase();
  const ziel = empfaenger.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "FIRM";
  return `FM-${monat}-${firma}-${ziel}`;
}

/**
 * Zeilen nach beförderndem Unternehmen gruppieren und je Gruppe die USt
 * aufschlüsseln. Ohne bekanntes Unternehmen entsteht ein Sammelabschnitt.
 */
export function corporateSections(
  lines: CorporateStatementLine[],
  carriers: Map<string, CorporateCarrier>,
  vatRate: (m?: number | null) => number,
  monthKey: string,
  empfaenger: string,
): CorporateSection[] {
  const map = new Map<string, CorporateStatementLine[]>();
  for (const l of lines) {
    const key = l.companyName ?? "__offen__";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(l);
  }

  return Array.from(map.entries()).map(([key, gruppe]) => {
    const carrier = key === "__offen__" ? null : carriers.get(key) ?? null;
    const total = round2(gruppe.reduce((sum, l) => sum + (l.amount ?? 0), 0));

    // USt getrennt je Satz: 7 % bis 50 km, darüber 19 %.
    const proSatz = new Map<number, number>();
    for (const l of gruppe) {
      const rate = vatRate(l.distanceMeters);
      proSatz.set(rate, round2((proSatz.get(rate) ?? 0) + (l.amount ?? 0)));
    }
    const vat = Array.from(proSatz.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([rate, gross]) => {
        const net = round2(gross / (1 + rate));
        return { rate, gross: round2(gross), net, tax: round2(gross - net) };
      });

    return {
      carrier,
      invoiceNo: rechnungsNummer(monthKey, carrier?.id ?? null, empfaenger),
      lines: gruppe,
      total,
      vat,
    };
  });
}
