// QA: Die Provisions-Sammelrechnung ist stillgelegt.
//
// Warum: Sie rechnete ausschließlich die Provision pro Fahrt ab. Seit die
// Provision abgeschafft ist (Einnahmen laufen über das Monats-Abo), könnte sie
// nur noch Rechnungen über 0,00 € erzeugen — und der Versand-Endpunkt hätte
// diese sogar per E-Mail an die Unternehmen geschickt. Genau das darf im
// Echtbetrieb nicht versehentlich passieren.
//
// Geprüft wird:
//  1) Alle vier Rechnungs-Endpunkte antworten mit einem klaren Hinweis (410)
//  2) Es wird nichts gerechnet, nichts erzeugt, nichts versendet
//  3) Die Kacheln sind aus der Super-Admin-Oberfläche entfernt
//  4) Stattdessen zeigt die Übersicht die tatsächlichen Abo-Einnahmen
//
// Aufruf: node scripts/qa/invoice_retired.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const fs = require("fs");
const path = require("path");
const H = require("./helpers");
const { check, info, section, finish, api } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const ROOT = path.resolve(__dirname, "../..");
const MONAT = new Date().toISOString().slice(0, 7);

async function main() {
  // Super-Admin-Sitzung: die Endpunkte verlangen diese Rolle, sonst käme 401
  // und wir hätten die Stilllegung gar nicht geprüft.
  const superFirma = await prisma.company.findFirst({ where: { role: "SUPER_ADMIN" }, select: { email: true } })
    .catch(() => null);
  let cookie = null;
  if (superFirma?.email) {
    const login = await H.post("/api/auth/login", { email: superFirma.email, password: process.env.SUPER_ADMIN_PASSWORD ?? "" });
    cookie = login.cookie;
  }
  info(cookie ? "Als Super-Admin angemeldet" : "Kein Super-Admin vorhanden – geprüft wird die Sperre vor der Rollenprüfung");

  // =========================================================================
  section("1) Die Rechnungs-Endpunkte rechnen nichts mehr");
  const endpunkte = [
    ["GET", "/api/super/invoices"],
    ["POST", "/api/super/invoices"],
    ["GET", `/api/super/invoices/${MONAT}`],
    ["POST", `/api/super/invoices/${MONAT}/send`],
    ["POST", "/api/super/invoices/id/beliebig"],
  ];
  for (const [methode, pfad] of endpunkte) {
    const res = await api(pfad, { method: methode, ...(methode === "POST" ? { body: "{}" } : {}) }, cookie);
    const gesperrt = res.status === 410 && res.body?.code === "INVOICE_MODULE_RETIRED";
    check(`${methode} ${pfad} ist stillgelegt`, gesperrt, { status: res.status, code: res.body?.code });
  }

  section("2) Der Hinweis ist für Menschen verständlich");
  const probe = await api("/api/super/invoices", {}, cookie);
  check("Grund wird genannt", /Provision/i.test(probe.body?.error ?? ""), probe.body?.error);
  check("Alternative wird genannt", /Abo|Stripe/i.test(`${probe.body?.error} ${probe.body?.hinweis}`), probe.body?.hinweis);
  info(`Meldung: ${probe.body?.error}`);

  section("3) Es wird nichts versendet und nichts gespeichert");
  const vorher = await prisma.invoice.count().catch(() => 0);
  await api(`/api/super/invoices/${MONAT}/send`, { method: "POST", body: "{}" }, cookie);
  await api("/api/super/invoices", { method: "POST", body: JSON.stringify({ action: "remind-overdue" }) }, cookie);
  const nachher = await prisma.invoice.count().catch(() => 0);
  check("Keine neuen Rechnungen entstanden", nachher === vorher, { vorher, nachher });

  section("4) Die Kacheln sind aus der Oberfläche entfernt");
  const seite = fs.readFileSync(path.join(ROOT, "src/app/super-admin/page.tsx"), "utf8");
  check("Keine Sammel-Abrechnung mehr eingebunden", !/<SuperInvoiceRun\s*\/>/.test(seite));
  check("Kein Rechnungs-Archiv mehr eingebunden", !/<SuperInvoiceArchive\s*\/>/.test(seite));
  check("Auch die Importe sind entfernt", !/import\s*\{\s*SuperInvoice/.test(seite));
  check("Grund ist im Code dokumentiert", /STILLGELEGT/.test(seite));

  section("5) Stattdessen zeigt die Übersicht die Abo-Einnahmen");
  // Nur die ANGEZEIGTE Überschrift prüfen – im Kommentar darüber steht das Wort
  // absichtlich noch, um zu erklären, was früher dort stand.
  const sichtbar = seite.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check("Keine 'Vermittlungseinnahmen'-Überschrift mehr", !/Vermittlungs/.test(sichtbar));
  check("Überschrift lautet jetzt 'Monats-Abos'", /Monats-Abos/.test(sichtbar));

  // Auch die Datenquelle darf die Provision nicht mehr ausweisen.
  const uebersichtQuelle = fs.readFileSync(path.join(ROOT, "src/app/api/super/overview/route.ts"), "utf8");
  check("Übersichts-API liefert Abo-Einnahmen", /subscriptionMonthly/.test(uebersichtQuelle));
  check("Übersichts-API liefert keine Provisionssumme mehr",
    !/^\s*platformFee:/m.test(uebersichtQuelle.replace(/\/\/.*$/gm, "")));
  check("Keine Provisions-Abzeichen (7 % / 5 %) mehr", !/Großstadt 7%|Klein\/Land 5%/.test(seite));
  check("Abo-Einnahmen werden angezeigt", /fin-subscription/.test(seite));
  check("Klarstellung für den Betreiber vorhanden", /keine Provision/i.test(seite));

  const uebersicht = await api("/api/super/overview", {}, cookie);
  if (uebersicht.status === 200) {
    const t = uebersicht.body?.totals ?? {};
    check("Übersicht liefert monatliche Abo-Einnahmen", typeof t.subscriptionMonthly === "number", t.subscriptionMonthly);
    check("Und zählt zahlende Unternehmen", typeof t.payingCompanies === "number", t.payingCompanies);
    check("Provisionssumme wird nicht mehr ausgewiesen", t.platformFee === undefined, t.platformFee);
    info(`Abo-Einnahmen: ${t.subscriptionMonthly} € / Monat bei ${t.payingCompanies} zahlenden Unternehmen`);
  } else {
    info(`Übersicht nicht prüfbar (HTTP ${uebersicht.status}) – benötigt einen Super-Admin.`);
  }

  await prisma.$disconnect();
  finish("RECHNUNGSMODUL-STILLGELEGT");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
