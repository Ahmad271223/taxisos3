// QA: Belege und Abrechnungen sind echte Rechnungen des TAXIUNTERNEHMENS.
//
// Vorher trat jedes Dokument als "TaxiOS Plattform GmbH" auf – obwohl die
// Beförderung das Taxiunternehmen erbringt und der Fahrpreis zu 100 % dorthin
// geht. Die Plattform stellte damit Beträge in Rechnung, von denen sie nichts
// bekommt. Ausserdem fehlten Pflichtangaben (Anschrift, Steuernummer,
// Rechnungsnummer, USt-Ausweis, Zahlungsziel) und Seitenzahlen.
//
// Geprüft wird der ECHTE PDF-Code mit echten Daten – die erzeugten Dokumente
// werden anschliessend als Text durchsucht und die Beträge nachgerechnet.
//
// Aufruf: node scripts/qa/pdf_invoices.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish } = H;

async function laden() {
  const { register } = require("tsx/cjs/api");
  register();
  return {
    ride: require("../../src/lib/ridePdf.ts"),
    inst: require("../../src/lib/institutionPdf.ts"),
    hotel: require("../../src/lib/hotelStatementPdf.ts"),
    corp: require("../../src/lib/corporatePdf.ts"),
    plat: require("../../src/lib/platformIssuer.ts"),
  };
}

// Textextraktion ausgelagert (siehe _pdftext.js): pdf-lib komprimiert die
// Inhaltsstroeme, im Rohbyte-Strom steht kein Klartext.
const { pdfText, seitenZahl } = require("./_pdftext");

const FIRMA = {
  name: "Taxi Şahin GmbH",
  address: "Bahnhofstraße 12, 30159 Hannover",
  taxId: "25/123/45678",
  vatId: "DE123456789",
  phone: "0511 123456",
};

async function main() {
  const { ride, inst, hotel, corp, plat } = await laden();

  // =========================================================================
  section("1) Fahrtbeleg: Aussteller ist das Taxiunternehmen");
  const beleg = await ride.rideReceiptPdf({
    receiptNo: "TX-ABC12345",
    dateIso: new Date().toISOString(),
    customerName: "Ayşe Şahin",
    pickup: "Hauptbahnhof",
    dest: "Klinik Nordstadt",
    vehicleClassLabel: "Standard Taxi",
    distanceMeters: 8200,
    fare: 24.5,
    tip: 2.5,
    paymentMethod: "CARD",
    paymentStatus: "BEZAHLT",
    carrier: FIRMA.name,
    carrierAddress: FIRMA.address,
    carrierPhone: FIRMA.phone,
    carrierTaxId: FIRMA.taxId,
    carrierVatId: FIRMA.vatId,
    driverName: "Miloš Nowaković",
    plate: "H-TX 123",
  });
  const t1 = pdfText(beleg);
  check("Taxiunternehmen steht im Kopf", t1.includes("Taxi Sahin GmbH"), t1.split("\n")[1]);
  check("Anschrift des Beförderers vorhanden", t1.includes("Bahnhofstra"));
  check("Steuernummer vorhanden (§ 33 UStDV)", t1.includes("25/123/45678"));
  check("USt-IdNr. vorhanden", t1.includes("DE123456789"));
  check("Vermittlerhinweis in der Fußzeile", t1.includes("Vermittelt"));
  check("Betreiberdaten aus der Konfiguration", t1.includes("IT Solutions by Ahmad Fakih"));
  check("Name des Fahrgasts lesbar (nicht '?ahin')", t1.includes("Ayse Sahin") && !t1.includes("?ahin"));
  check("Fahrername lesbar", t1.includes("Milos Nowakovic"));

  section("2) Fahrtbeleg: USt nach Strecke, Trinkgeld getrennt");
  check("Kurzstrecke → 7 %", ride.taxiVatRate(8200) === 0.07, ride.taxiVatRate(8200));
  check("Über 50 km → 19 %", ride.taxiVatRate(62000) === 0.19, ride.taxiVatRate(62000));
  check("Beleg weist 7 % aus", t1.includes("USt 7 %"));
  // 24,50 brutto bei 7 % -> netto 22,90, USt 1,60. Gesamt mit Trinkgeld 27,00.
  check("Nettobetrag korrekt (22,90)", t1.includes("22,90"));
  check("USt-Betrag korrekt (1,60)", t1.includes("1,60"));
  check("Trinkgeld separat ausgewiesen", t1.includes("Trinkgeld"));
  check("Gesamtbetrag inkl. Trinkgeld (27,00)", t1.includes("27,00"));
  info("Trinkgeld ist freiwillig und damit kein Entgeltbestandteil – USt nur auf den Fahrpreis.");

  const lang = await ride.rideReceiptPdf({
    receiptNo: "TX-LANG",
    dateIso: new Date().toISOString(),
    customerName: "Test",
    pickup: "A",
    dest: "B",
    vehicleClassLabel: "Standard",
    distanceMeters: 62000,
    fare: 119.0,
    paymentMethod: "CASH",
    paymentStatus: "OFFEN",
    carrier: FIRMA.name,
  });
  const t1b = pdfText(lang);
  check("Fernfahrt weist 19 % aus", t1b.includes("USt 19 %"));
  check("Netto bei 19 % korrekt (100,00)", t1b.includes("100,00"));

  // =========================================================================
  section("3) Einrichtungs-Abrechnung: eine Rechnung JE Unternehmen");
  const firmaA = {
    id: "cmpaaaa1111", name: "Taxi Alpha GmbH", address: "Weg 1, 30159 Hannover",
    phone: null, email: null, taxId: "11/111/11111", vatId: "DE111111111",
  };
  const firmaB = {
    id: "cmpbbbb2222", name: "Beta Fahrdienst", address: "Weg 2, 30161 Hannover",
    phone: null, email: null, taxId: null, vatId: null,
  };
  const zeile = (i, firma, betrag, fertig) => ({
    id: "b" + i,
    date: new Date().toISOString(),
    patient: i % 2 ? "Łukasz Wiśniewski" : "Erna Müller",
    route: "Seniorenheim Waldweg 3 → Dialysezentrum Nordstadt",
    status: fertig ? "ABGESCHLOSSEN" : "OFFEN",
    payerType: "INSURANCE",
    billable: fertig,
    amount: betrag,
    companyName: firma,
    distanceMeters: 7000,
  });
  const st = {
    monthKey: "2026-08",
    periodLabel: "August 2026",
    issuedAtIso: new Date().toISOString(),
    institution: { name: "Dialysezentrum Nordstadt", type: "DIALYSE", address: "Klinikweg 9, 30167 Hannover" },
    rides: 5, completed: 4, totalBillable: 130, totalPlanned: 30,
    lines: [],
    sections: [
      {
        company: firmaA, invoiceNo: "KF-202608-AAA1-XYZ", completed: 3,
        totalBillable: 100, totalPlanned: 0,
        lines: [zeile(1, "Taxi Alpha GmbH", 40, true), zeile(2, "Taxi Alpha GmbH", 30, true), zeile(3, "Taxi Alpha GmbH", 30, true)],
        vat: [{ rate: 0.07, gross: 100, net: 93.46, tax: 6.54 }],
      },
      {
        company: firmaB, invoiceNo: "KF-202608-BBB2-XYZ", completed: 1,
        totalBillable: 30, totalPlanned: 30,
        lines: [zeile(4, "Beta Fahrdienst", 30, true), zeile(5, "Beta Fahrdienst", 30, false)],
        vat: [{ rate: 0.07, gross: 30, net: 28.04, tax: 1.96 }],
      },
    ],
  };
  const pdf2 = await inst.institutionStatementPdf(st);
  const t2 = pdfText(pdf2);
  check("Beide Unternehmen sind Aussteller", t2.includes("Taxi Alpha GmbH") && t2.includes("Beta Fahrdienst"));
  check("Je Abschnitt eine Rechnungsnummer", t2.includes("KF-202608-AAA1") && t2.includes("KF-202608-BBB2"));
  check("Rechnungsdatum vorhanden", t2.includes("Rechnungsdatum"));
  check("USt-Ausweis vorhanden", t2.includes("USt 7 %"));
  check("Nettobetrag ausgewiesen (93,46)", t2.includes("93,46"));
  check("Zahlungsziel genannt", t2.includes("Zahlbar ohne Abzug"));
  check("Fehlende Steuernummer wird angemahnt", t2.includes("noch nicht hinterlegt"));
  check("Patientenname lesbar", t2.includes("Lukasz Wisniewski"));
  check("Kein Fragezeichen im Dokument", !t2.includes("?"));
  check("Ziel der Fahrt bleibt lesbar", t2.includes("Dialysezentrum Nordstadt"));
  const marken = (t2.match(/Seite \d+ von \d+/g) || []).length;
  check("Seitenzahl auf jeder Seite", marken >= seitenZahl(pdf2), `${marken} Marken / ${seitenZahl(pdf2)} Seiten`);
  info(`${seitenZahl(pdf2)} Seiten erzeugt`);

  // =========================================================================
  section("4) Hotel-Abrechnung: Strecke wird jetzt gedruckt");
  const hZeilen = [
    { date: new Date().toISOString(), guest: "Ayşe Şahin", room: "204", mode: "Zimmer", route: "Hotel Adler → Flughafen HAJ", fare: 42.0, companyName: "Taxi Alpha GmbH", distanceMeters: 12000 },
    { date: new Date().toISOString(), guest: "Jörg Weiß", room: "108", mode: "Firmenkonto", route: "Hotel Adler → Messegelände", fare: 18.5, companyName: "Taxi Alpha GmbH", distanceMeters: 6000 },
  ];
  const carriers = new Map([
    ["Taxi Alpha GmbH", { id: firmaA.id, name: firmaA.name, address: firmaA.address, taxId: firmaA.taxId, vatId: firmaA.vatId }],
  ]);
  const pdf3 = await hotel.hotelStatementPdf({
    hotelName: "Hotel Adler",
    hotelAddress: "Marktplatz 1, 30159 Hannover",
    periodLabel: "August 2026",
    monthKey: "2026-08",
    issuedAtIso: new Date().toISOString(),
    lines: hZeilen,
    total: 60.5,
    sections: hotel.hotelSections(hZeilen, carriers, ride.taxiVatRate),
  });
  const t3 = pdfText(pdf3);
  check("Taxiunternehmen ist Aussteller", t3.includes("Taxi Alpha GmbH"));
  check("Hotel ist Rechnungsempfänger", t3.includes("Hotel Adler"));
  check("STRECKE wird gedruckt (war der Fehler)", t3.includes("Flughafen HAJ"));
  check("Zweite Strecke ebenfalls", t3.includes("Messegel"));
  check("Rechnungsnummer vorhanden", t3.includes("HT-202608"));
  check("USt ausgewiesen", t3.includes("USt 7 %"));
  check("Seitenzahl vorhanden", /Seite \d+ von \d+/.test(t3));
  check("Gastname lesbar", t3.includes("Ayse Sahin"));

  // =========================================================================
  section("5) Betreiberdaten zentral gepflegt");
  const p = plat.platformIssuer();
  check("Firmenname hinterlegt", p.name === "IT Solutions by Ahmad Fakih", p.name);
  check("USt-IdNr. hinterlegt", p.vatId === "DE462836430", p.vatId);
  check("Anschrift vollständig", p.street.includes("Baldur") && p.zip === "30657" && p.city === "Hannover", `${p.street}, ${p.zip} ${p.city}`);
  check("Fußzeile nennt den Vermittler", plat.platformFooter().includes("IT Solutions by Ahmad Fakih"), plat.platformFooter());


  // =========================================================================
  section("6) Firmenmobilität: Aussteller ist das Taxiunternehmen");
  const fmZeilen = [
    { date: new Date(), guest: "Ayşe Şahin", route: "Messegelände Hannover → Flughafen HAJ",
      code: "FM-2026-A1", amount: 48.0, companyName: "Taxi Alpha GmbH", distanceMeters: 21000 },
    { date: new Date(), guest: "Jörg Weiß", route: "Kongresszentrum → Hotel Adler",
      code: "FM-2026-A2", amount: 22.0, companyName: "Taxi Alpha GmbH", distanceMeters: 7000 },
    { date: new Date(), guest: "Łukasz Wiśniewski", route: "Hauptbahnhof → Wolfsburg Werk",
      code: "FM-2026-B1", amount: 140.0, companyName: "Beta Fahrdienst", distanceMeters: 72000 },
  ];
  const fmCarriers = new Map([
    ["Taxi Alpha GmbH", { id: firmaA.id, name: firmaA.name, address: firmaA.address, taxId: firmaA.taxId, vatId: firmaA.vatId }],
    ["Beta Fahrdienst", { id: firmaB.id, name: firmaB.name, address: firmaB.address, taxId: null, vatId: null }],
  ]);
  const fmSections = corp.corporateSections(fmZeilen, fmCarriers, ride.taxiVatRate, "2026-08", "Continental AG");
  const pdf4 = await corp.corporateStatementPdf({
    company: "Continental AG",
    companyAddress: "Vahrenwalder Straße 9, 30165 Hannover",
    periodLabel: "August 2026",
    monthKey: "2026-08",
    issuedAtIso: new Date().toISOString(),
    lines: fmZeilen,
    total: 210.0,
    sections: fmSections,
  });
  const t4 = pdfText(pdf4);
  check("Beide Unternehmen sind Aussteller", t4.includes("Taxi Alpha GmbH") && t4.includes("Beta Fahrdienst"));
  check("Nicht mehr die Plattform im Kopf", !t4.includes("TaxiOS Plattform"));
  check("Empfängerfirma genannt", t4.includes("Continental AG"));
  check("Empfängeranschrift gedruckt (§ 14 UStG)", t4.includes("Vahrenwalder"));
  check("Rechnungsnummer je Abschnitt", /FM-202608-/.test(t4), (t4.match(/FM-202608-\S+/g) || []).slice(0, 2).join(" "));
  check("Rechnungsdatum vorhanden", t4.includes("Rechnungsdatum"));
  check("Zahlungsziel genannt", t4.includes("Zahlbar ohne Abzug"));
  check("Kurzstrecken mit 7 % ausgewiesen", t4.includes("USt 7 %"));
  check("Fernfahrt mit 19 % ausgewiesen", t4.includes("USt 19 %"));
  check("Fehlende Steuernummer wird angemahnt", t4.includes("noch nicht hinterlegt"));
  check("Ziel der Fahrt bleibt lesbar", t4.includes("Flughafen HAJ") && t4.includes("Wolfsburg Werk"));
  check("Namen lesbar (keine Fragezeichen)", t4.includes("Ayse Sahin") && t4.includes("Lukasz Wisniewski") && !t4.includes("?"));
  check("Seitenzahl auf jeder Seite", (t4.match(/Seite \d+ von \d+/g) || []).length >= seitenZahl(pdf4));
  check("Vermittlerhinweis in der Fußzeile", t4.includes("IT Solutions by Ahmad Fakih"));
  // 48,00 + 22,00 bei 7 % = 70,00 brutto -> netto 65,42, USt 4,58
  const alpha = fmSections.find((s) => s.carrier?.name === "Taxi Alpha GmbH");
  check("Summe je Unternehmen korrekt (70,00)", alpha?.total === 70, alpha?.total);
  check("Netto korrekt gerechnet (65,42)", alpha?.vat?.[0]?.net === 65.42, alpha?.vat?.[0]?.net);
  const beta = fmSections.find((s) => s.carrier?.name === "Beta Fahrdienst");
  check("Fernfahrt bekommt 19 %", beta?.vat?.[0]?.rate === 0.19, beta?.vat?.[0]?.rate);

    finish("PDF-RECHNUNGEN");
}

main().catch((e) => {
  console.error("Abgebrochen:", e.message);
  process.exit(1);
});
