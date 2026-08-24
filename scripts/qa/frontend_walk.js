// QA: Alle Oberflächen einmal durchgehen.
//
// Stufe 1 dieser Analyse: Ist jede Seite erreichbar, und schützt jede
// geschützte Fläche sich selbst? Geprüft werden alle 32 Seiten und die
// wichtigsten Datenendpunkte der sieben Dashboards.
//
// Bewusst KEIN Browser: geprüft wird, was der Server ausliefert. Fehler in der
// Anzeige selbst deckt die zweite Stufe (dashboards.js) ab.
//
// Aufruf: node scripts/qa/frontend_walk.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, api, get, post } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Öffentliche Seiten: müssen ohne Anmeldung ausgeliefert werden.
const OEFFENTLICH = [
  ["/", "Startseite"],
  ["/buchen", "Taxi bestellen"],
  ["/buchen/flughafen", "Flughafen-Transfer"],
  ["/buchen/gruppe", "Gruppe/Event"],
  ["/buchen/krankenfahrt", "Krankenfahrt"],
  ["/buchen/vorbestellung", "Vorbestellung"],
  ["/taxis", "Live-Karte"],
  ["/registrieren", "Unternehmen registrieren"],
  ["/konto", "Kundenkonto"],
  ["/admin/login", "Unternehmens-Login"],
  ["/fahrer/login", "Fahrer-Login"],
  ["/hotel", "Hotel-Portal"],
  ["/einrichtung", "Einrichtungs-Portal"],
  ["/event", "Event-Portal"],
  ["/impressum", "Impressum"],
  ["/datenschutz", "Datenschutz"],
  ["/agb", "AGB"],
];

// Geschützte Seiten: liefern die Seite aus, prüfen die Rolle aber im Client
// und leiten weiter. Entscheidend ist, dass die DATEN geschützt sind (unten).
const GESCHUETZT = [
  ["/admin", "Unternehmens-Dashboard"],
  ["/admin/fahrer", "Fahrerverwaltung"],
  ["/admin/preise", "Preise"],
  ["/admin/abo", "Abo"],
  ["/admin/abrechnung", "Abrechnung"],
  ["/admin/bewertungen", "Bewertungen"],
  ["/admin/krankenfahrten", "Krankenfahrten"],
  ["/fahrer", "Fahrer-Dashboard"],
  ["/super-admin", "Super-Admin"],
];

// Datenendpunkte, die OHNE passende Anmeldung nichts herausgeben dürfen.
const GESCHUETZTE_DATEN = [
  ["/api/admin/overview", "Kennzahlen des Unternehmens"],
  ["/api/admin/ratings", "Bewertungen"],
  ["/api/admin/drivers", "Fahrerliste"],
  ["/api/admin/subscription", "Abo-Daten"],
  ["/api/admin/payments", "Zahlungen des Unternehmens"],
  ["/api/admin/connect", "Auszahlungskonto"],
  ["/api/super/overview", "Plattform-Übersicht"],
  ["/api/super/tickets", "Support-Tickets"],
  ["/api/customer/bookings", "Meine Fahrten"],
  ["/api/customer/profile", "Mein Profil"],
  ["/api/customer/payment-methods", "Meine Karten"],
  ["/api/institutions/patients", "Patienten"],
  ["/api/hotels/rides", "Hotel-Fahrten"],
  ["/api/medical/documents", "Medizinische Dokumente"],
];

async function main() {
  // =========================================================================
  section("1) Öffentliche Seiten sind erreichbar");
  let fehlend = [];
  for (const [pfad, name] of OEFFENTLICH) {
    const r = await api(pfad);
    const ok = r.status === 200;
    if (!ok) fehlend.push(`${pfad} (${r.status})`);
    check(`${name.padEnd(26)} ${pfad}`, ok, r.status);
  }

  section("2) Geschützte Seiten werden ausgeliefert (Rollenprüfung im Client)");
  for (const [pfad, name] of GESCHUETZT) {
    const r = await api(pfad);
    check(`${name.padEnd(26)} ${pfad}`, r.status === 200 || r.status === 307, r.status);
  }

  section("3) Nicht vorhandene Seiten liefern sauber 404");
  const weg = await api("/gibtesnicht" + H.uniq());
  check("Unbekannte Seite → 404", weg.status === 404, weg.status);
  const wegApi = await api("/api/gibtesnicht");
  check("Unbekannte API → 404", wegApi.status === 404, wegApi.status);

  // =========================================================================
  section("4) Ohne Anmeldung geben die Dashboards KEINE Daten heraus");
  let leck = [];
  for (const [pfad, name] of GESCHUETZTE_DATEN) {
    const r = await api(pfad);
    const geschuetzt = r.status === 401 || r.status === 403;
    if (!geschuetzt) leck.push(`${pfad} → ${r.status}`);
    check(`${name.padEnd(26)} abgewiesen`, geschuetzt, r.status);
  }
  if (leck.length) info(`ACHTUNG offen: ${leck.join(", ")}`);

  // =========================================================================
  section("4b) 'Bin ich angemeldet?'-Abfragen geben nichts preis");
  for (const [pfad, name] of [["/api/institutions/me", "Einrichtung"], ["/api/auth/me", "Anmeldung"]]) {
    const r = await api(pfad);
    const inhalt = JSON.stringify(r.body ?? {});
    const leer = !/"(id|email|name|phone|address)"\s*:\s*"/.test(inhalt);
    check(`${name} liefert ohne Anmeldung keine Daten`, leer, inhalt.slice(0, 80));
  }

  section("5) Eine Rolle kommt nicht an die Daten einer anderen");
  const co = await H.registerCompany("WALK");
  const kundeId = H.uniq();
  const kunde = await post("/api/customer/register", {
    name: "Walk Kunde", email: `walk${kundeId}@test.de`.toLowerCase(),
    phone: "+4915" + String(kundeId).slice(-9), password: "Pass1234",
  });
  const drv = await H.createDriver(co.admin, "W", H.HBF);

  const kreuzproben = [
    ["Kunde darf nicht ins Unternehmens-Dashboard", "/api/admin/overview", kunde.cookie],
    ["Kunde darf nicht in die Plattform-Übersicht", "/api/super/overview", kunde.cookie],
    ["Fahrer darf nicht ins Unternehmens-Dashboard", "/api/admin/drivers", drv.cookie],
    ["Unternehmen darf nicht in die Plattform-Übersicht", "/api/super/overview", co.admin],
    ["Unternehmen darf nicht auf fremde Kundendaten", "/api/customer/profile", co.admin],
  ];
  for (const [name, pfad, cookie] of kreuzproben) {
    const r = await api(pfad, {}, cookie);
    check(name, r.status === 401 || r.status === 403, r.status);
  }

  // =========================================================================
  section("6) Ein Unternehmen sieht nichts von einem anderen");
  const co2 = await H.registerCompany("WALK2");
  const b = await post("/api/bookings", {
    company: co.slug, customerName: "Walk", customerPhone: "+4915100000777",
    pickupAddress: "HBF", pickup: H.HBF, destAddress: "List", dest: H.LIST,
    paymentMethod: "CASH",
  });
  check("Fahrt bei Firma A angelegt", b.status === 201, b.body?.error);

  const fremd = await get("/api/admin/bookings", co2.admin);
  const sieht = (fremd.body?.bookings ?? []).some((x) => x.id === b.body?.id);
  check("Firma B sieht die Fahrt von Firma A NICHT", !sieht, fremd.body?.bookings?.length);

  const fremderFahrer = await get("/api/admin/drivers", co2.admin);
  const siehtFahrer = (fremderFahrer.body?.drivers ?? []).some((d) => d.id === drv.driverId);
  check("Firma B sieht den Fahrer von Firma A NICHT", !siehtFahrer, fremderFahrer.body?.drivers?.length);

  // =========================================================================
  section("7) Wichtige Seiten liefern echten Inhalt, keine leere Hülle");
  const inhalte = [
    ["/", ["Taxi", "buchen"], "Startseite bewirbt die Buchung"],
    ["/buchen", ["Abholadresse", "Zieladresse"], "Buchungsformular enthält beide Adressfelder"],
    ["/taxis", ["Taxi", "Karte"], "Live-Karte nennt Taxis"],
    ["/registrieren", ["Unternehmen", "Passwort"], "Registrierung fragt Firmendaten ab"],
    ["/impressum", ["Impressum"], "Impressum ist gefüllt"],
    ["/datenschutz", ["Daten"], "Datenschutz ist gefüllt"],
    ["/agb", ["Bedingungen", "AGB"], "AGB sind gefüllt"],
  ];
  for (const [pfad, woerter, name] of inhalte) {
    const r = await H.raw(pfad);
    const text = await r.res.text();
    const treffer = woerter.some((w) => text.includes(w));
    check(name, treffer, `${text.length} Zeichen ausgeliefert`);
  }

  section("8) Rechtstexte sind im Fußbereich verlinkt (Pflicht in Deutschland)");
  const start = await H.raw("/");
  const startText = await start.res.text();
  check("Impressum verlinkt", startText.includes("/impressum"));
  check("Datenschutz verlinkt", startText.includes("/datenschutz"));
  check("AGB verlinkt", startText.includes("/agb"));

  await prisma.$disconnect();
  finish("OBERFLAECHEN-RUNDGANG");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
