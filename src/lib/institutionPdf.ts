// PDF der Einrichtungs-Monatsabrechnung (Phase E) mit pdf-lib (pure JS).
//
// EINE RECHNUNG JE TAXIUNTERNEHMEN in einem Dokument: Aussteller jedes
// Abschnitts ist das Unternehmen, das die Fahrten erbracht hat – nicht die
// Plattform (die stellt hier keine Leistung in Rechnung und bekommt vom
// Fahrpreis nichts). Jeder Abschnitt traegt Rechnungsnummer, Rechnungsdatum,
// USt-Ausweis (7 %/19 % nach Strecke) und Zahlungsziel; Folgeseiten tragen
// Aussteller, Zeitraum und Seitenzahl. Fahrten ohne zugewiesenes Unternehmen
// erscheinen nachrichtlich in einem eigenen Abschnitt.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { InstitutionStatement, CompanySection } from "@/lib/institutionInvoice";
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

const TYPE_LABEL: Record<string, string> = {
  KLINIK: "Klinik", PFLEGEHEIM: "Pflegeheim", DIALYSE: "Dialysezentrum", REHA: "Reha-Zentrum",
};

export async function institutionStatementPdf(s: InstitutionStatement): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Abrechnung ${s.periodLabel} – ${s.institution?.name ?? "Einrichtung"}`);
  doc.setProducer("TaxiOS");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - M;

  const text = (t: string, x: number, yy: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(safe(t), { x, y: yy, size, font: f, color });
  const right = (t: string, rx: number, yy: number, size: number, f: PDFFont = font, color = INK) => {
    const v = safe(t);
    page.drawText(v, { x: rx - f.widthOfTextAtSize(v, size), y: yy, size, font: f, color });
  };
  const hline = (yy: number, color = LINE) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: RIGHT, y: yy }, thickness: 1, color });

  // Seitenzuordnung fuer den zweiten Durchlauf (Fusszeile mit Seite X von Y).
  const seitenVon = new Map<number, { aussteller: string }>();
  let seitenAussteller = "";

  const neueSeite = () => {
    page = doc.addPage(A4);
    y = A4[1] - M;
    seitenVon.set(doc.getPageCount() - 1, { aussteller: seitenAussteller });
  };

  const clip = (s0: string, max: number, size = 9): string => {
    let v = safe(s0);
    if (font.widthOfTextAtSize(v, size) <= max) return v;
    while (v.length > 4 && font.widthOfTextAtSize(v + "...", size) > max) v = v.slice(0, -1);
    return v + "...";
  };

  // Spalten: das ZIEL der Fahrt (Dialyse, Klinik) muss lesbar bleiben –
  // deshalb wird die Route bei Platzmangel VORNE gekuerzt, nicht hinten.
  const COL = { date: M, patient: M + 60, route: M + 178, status: 428, amount: RIGHT };
  const clipRouteZielErhalten = (route: string, max: number, size = 9): string => {
    let v = safe(route);
    if (font.widthOfTextAtSize(v, size) <= max) return v;
    while (v.length > 4 && font.widthOfTextAtSize("..." + v, size) > max) v = v.slice(1);
    return "..." + v;
  };

  const kopfzeileTabelle = () => {
    text("Datum", COL.date, y, 8.5, bold, MUTED);
    text("Patient", COL.patient, y, 8.5, bold, MUTED);
    text("Fahrt", COL.route, y, 8.5, bold, MUTED);
    text("Status", COL.status, y, 8.5, bold, MUTED);
    right("Betrag", COL.amount, y, 8.5, bold, MUTED);
    y -= 6; hline(y); y -= 14;
  };

  const ROW = 15;
  const BOTTOM = 130;

  const abschnitt = (sec: CompanySection, erste: boolean) => {
    const aussteller = sec.company?.name ?? "Noch nicht zugewiesene Fahrten";
    seitenAussteller = aussteller;
    if (!erste) neueSeite();
    else seitenVon.set(doc.getPageCount() - 1, { aussteller });

    // ---- Kopf: Aussteller = Taxiunternehmen ----
    page.drawRectangle({ x: M, y: y - 4, width: 26, height: 26, color: BRAND });
    text((sec.company?.name ?? "TX").slice(0, 2).toUpperCase(), M + 5, y + 2, 13, bold);
    text(aussteller, M + 34, y + 4, 15, bold);
    if (sec.company?.address) text(sec.company.address, M + 34, y - 9, 9, font, MUTED);
    const steuer = [
      sec.company?.taxId ? `St.-Nr. ${sec.company.taxId}` : null,
      sec.company?.vatId ? `USt-IdNr. ${sec.company.vatId}` : null,
    ].filter(Boolean).join("  ·  ");
    if (steuer) text(steuer, M + 34, y - 21, 8.5, font, MUTED);

    right(sec.company ? "RECHNUNG" : "NACHRICHTLICH", RIGHT, y + 2, 20, bold, INK);
    right("Krankenfahrten", RIGHT, y - 14, 10, font, MUTED);
    if (sec.invoiceNo) right(`Rechnungs-Nr. ${sec.invoiceNo}`, RIGHT, y - 27, 10, font, MUTED);
    right(`Rechnungsdatum: ${dmy(s.issuedAtIso)}  ·  Zeitraum: ${s.periodLabel}`, RIGHT, y - 40, 9, font, MUTED);

    y -= 76;

    // ---- Empfaenger (Einrichtung) ----
    text("RECHNUNG AN", M, y, 8, bold, MUTED);
    y -= 15;
    text(s.institution?.name ?? "Einrichtung", M, y, 12, bold);
    y -= 14;
    const typ = TYPE_LABEL[s.institution?.type ?? ""] ?? (s.institution?.type ?? "");
    if (typ) { text(typ, M, y, 10, font, MUTED); y -= 13; }
    if (s.institution?.address) { text(s.institution.address, M, y, 10, font, MUTED); y -= 13; }

    y -= 12;
    kopfzeileTabelle();

    for (const l of sec.lines) {
      if (y < BOTTOM) { neueSeite(); fortsetzungsKopf(aussteller); kopfzeileTabelle(); }
      text(dmy(l.date), COL.date, y, 9, font);
      text(clip(l.patient, COL.route - COL.patient - 8), COL.patient, y, 9, font);
      text(clipRouteZielErhalten(l.route, COL.status - COL.route - 8), COL.route, y, 9, font);
      text(l.billable ? "abgeschl." : "geplant", COL.status, y, 9, font, l.billable ? INK : MUTED);
      right(eur(l.amount), COL.amount, y, 9, font, l.billable ? INK : MUTED);
      y -= ROW;
    }
    if (sec.lines.length === 0) {
      text("Keine Fahrten in diesem Zeitraum.", COL.date, y, 10, font, MUTED);
      y -= ROW;
    }

    // ---- Summen + USt-Ausweis ----
    if (y < BOTTOM + 90) { neueSeite(); fortsetzungsKopf(aussteller); }
    y -= 4; hline(y); y -= 20;
    const labelX = 300;
    if (sec.totalPlanned > 0) {
      text("Geplant (nachrichtlich, nicht Teil der Rechnung)", labelX, y, 9.5, font, MUTED);
      right(eur(sec.totalPlanned), RIGHT, y, 9.5, font, MUTED);
      y -= 16;
    }
    for (const v of sec.vat) {
      text(`Nettobetrag (USt ${Math.round(v.rate * 100)} %)`, labelX, y, 10, font, MUTED);
      right(eur(v.net), RIGHT, y, 10, font);
      y -= 14;
      text(`USt ${Math.round(v.rate * 100)} %`, labelX, y, 10, font, MUTED);
      right(eur(v.tax), RIGHT, y, 10, font);
      y -= 16;
    }
    y -= 2; hline(y); y -= 18;
    text(sec.company ? "Rechnungsbetrag" : "Summe (nachrichtlich)", labelX, y, 12, bold);
    right(eur(sec.totalBillable), RIGHT, y, 12, bold);
    y -= 22;
    if (sec.company) {
      const ziel = new Date(new Date(s.issuedAtIso).getTime() + 14 * 24 * 3600 * 1000);
      text(`Zahlbar ohne Abzug bis ${dmy(ziel.toISOString())}. Leistung: Krankenbeförderung im Taxiverkehr.`, M, y, 9, font, MUTED);
      y -= 13;
      if (!sec.company.taxId && !sec.company.vatId) {
        text("Hinweis: Steuernummer des Ausstellers noch nicht hinterlegt – bitte im Unternehmensprofil ergänzen.", M, y, 8.5, font, MUTED);
        y -= 13;
      }
    } else {
      text("Diese Fahrten sind noch keinem Taxiunternehmen zugewiesen und werden nicht berechnet.", M, y, 9, font, MUTED);
      y -= 13;
    }
  };

  const fortsetzungsKopf = (aussteller: string) => {
    text(aussteller, M, y, 11, bold);
    right(`Krankenfahrten · ${s.periodLabel} · Fortsetzung`, RIGHT, y, 9, font, MUTED);
    y -= 10; hline(y); y -= 16;
  };

  const sections = s.sections.length
    ? s.sections
    : [{ company: null, invoiceNo: null, lines: [], completed: 0, totalBillable: 0, totalPlanned: 0, vat: [] } as CompanySection];
  sections.forEach((sec, i) => abschnitt(sec, i === 0));

  // ---- Zweiter Durchlauf: Fusszeile mit Identitaet + Seitenzahl ----
  const gesamt = doc.getPageCount();
  doc.getPages().forEach((p, i) => {
    const meta = seitenVon.get(i);
    const fuss = `${meta?.aussteller ?? ""} · ${s.institution?.name ?? ""} · ${s.periodLabel} · Seite ${i + 1} von ${gesamt} · ${platformFooter()}`;
    const v = safe(fuss);
    p.drawLine({ start: { x: M, y: 58 }, end: { x: RIGHT, y: 58 }, thickness: 1, color: LINE });
    p.drawText(v, { x: M, y: 44, size: 8, font, color: MUTED });
  });

  return doc.save();
}
