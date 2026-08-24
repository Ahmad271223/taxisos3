// QA: Verhalten unter hoher Last – realistischer Feierabend/Schichtwechsel.
//
// Der vorhandene loadtest.js prüft die Grundlast (16 Fahrer, 40 Fahrten).
// Dieser hier geht deutlich darüber hinaus und misst gezielt das, was im
// Echtbetrieb zuerst bricht:
//
//   1. Viele Fahrer melden sich GLEICHZEITIG an (Schichtbeginn)
//   2. Viele Fahrgäste bestellen GLEICHZEITIG (Feierabend, Regen)
//   3. Dauerhafte GPS-Meldungen – jede kann eine Routenabfrage auslösen
//   4. Bleiben die Dashboards währenddessen bedienbar?
//   5. Ist die Datenlage danach widerspruchsfrei?
//
// Aufruf: node scripts/qa/loadtest_heavy.js [fahrer] [fahrten]
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep, api, get, post, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { io } = require("socket.io-client");

const FAHRER = Number(process.argv[2] ?? 40);
const FAHRTEN = Number(process.argv[3] ?? 120);
const FIRMEN = Math.ceil(FAHRER / 20); // P20 = max. 20 Fahrer je Firma

const ms = () => Date.now();
function stat(werte) {
  if (!werte.length) return { median: 0, p95: 0, max: 0 };
  const s = [...werte].sort((a, b) => a - b);
  return {
    median: s[Math.floor(s.length * 0.5)],
    p95: s[Math.floor(s.length * 0.95)] ?? s[s.length - 1],
    max: s[s.length - 1],
  };
}
const zeige = (name, w) => {
  const t = stat(w);
  info(`${name}: median ${t.median} ms · p95 ${t.p95} ms · max ${t.max} ms  (${w.length} Messungen)`);
  return t;
};

// Zufällige Position im Großraum Hannover.
const irgendwo = () => ({
  lat: HBF.lat + (Math.random() - 0.5) * 0.03,
  lng: HBF.lng + (Math.random() - 0.5) * 0.04,
});

async function main() {
  console.log(`Lastprofil: ${FAHRER} Fahrer in ${FIRMEN} Firmen, ${FAHRTEN} gleichzeitige Fahrten\n`);
  const t0 = ms();

  // =========================================================================
  section("1) Aufbau: Firmen und Fahrer");
  const firmen = [];
  for (let i = 0; i < FIRMEN; i++) {
    const co = await H.registerCompany(`HL${i}`);
    // Tarif P20 – sonst lehnt die App ab dem 6. Fahrer korrekt ab.
    await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });
    firmen.push(co);
  }
  check(`${FIRMEN} Firmen angelegt`, firmen.length === FIRMEN, firmen.length);

  const fahrer = [];
  for (let i = 0; i < FAHRER; i++) {
    const co = firmen[i % FIRMEN];
    const d = await H.createDriver(co.admin, `H${i}`, irgendwo());
    if (!d.cookie) { info(`Fahrer ${i} abgelehnt (${d.created.status}) – Tarifgrenze?`); continue; }
    fahrer.push({ ...d, co });
  }
  check(`${FAHRER} Fahrer mit gültiger Anmeldung`, fahrer.length === FAHRER, `${fahrer.length}/${FAHRER}`);

  // =========================================================================
  section("2) Schichtbeginn: alle Fahrer melden sich GLEICHZEITIG an");
  const verbindeZeiten = [];
  const sockets = [];
  const ergebnis = await Promise.all(fahrer.map((f) => new Promise((res) => {
    const start = ms();
    const s = io(H.BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: f.cookie },
                           transports: ["polling", "websocket"], forceNew: true });
    const timer = setTimeout(() => res({ ok: false, sock: s }), 25000);
    s.once("driver:state", () => {
      clearTimeout(timer);
      verbindeZeiten.push(ms() - start);
      res({ ok: true, sock: s });
    });
  })));
  ergebnis.forEach((r) => sockets.push(r.sock));
  const verbunden = ergebnis.filter((r) => r.ok).length;
  check("Alle Fahrer bekommen ihren Auftragsstand", verbunden === fahrer.length, `${verbunden}/${fahrer.length}`);
  const vT = zeige("Anmeldung", verbindeZeiten);
  check("Anmeldung dauert unter 5 s (p95)", vT.p95 < 5000, vT.p95);

  // Alle auf FREI und positionieren.
  const angebote = sockets.map((s) => H.collect(s, "driver:offer"));
  await Promise.all(sockets.map((s, i) => {
    s.emit("driver:location", fahrer[i]?.pos ?? HBF);
    return new Promise((r) => s.emit("driver:status", { status: "FREI" }, r));
  }));
  await sleep(1500);

  // =========================================================================
  section("3) Stoßzeit: viele Fahrgäste bestellen gleichzeitig");
  const buchZeiten = [];
  const buchungen = await Promise.all(Array.from({ length: FAHRTEN }, async (_, i) => {
    const co = firmen[i % FIRMEN];
    const start = ms();
    const r = await post("/api/bookings", {
      company: co.slug, customerName: `Last ${i}`, customerPhone: "+49151" + String(2000000 + i),
      pickupAddress: `Abholung ${i}`, pickup: irgendwo(), destAddress: `Ziel ${i}`, dest: LIST,
      paymentMethod: "CASH",
    });
    buchZeiten.push(ms() - start);
    return r;
  }));
  const ok = buchungen.filter((b) => b.status === 201);
  check("Alle Bestellungen angenommen", ok.length === FAHRTEN, `${ok.length}/${FAHRTEN}`);
  const bT = zeige("Bestellung", buchZeiten);
  check("Bestellung dauert unter 5 s (p95)", bT.p95 < 5000, bT.p95);
  const fehler = buchungen.filter((b) => b.status >= 500);
  check("Keine Serverfehler beim Bestellen", fehler.length === 0, fehler.map((f) => f.status));

  // =========================================================================
  section("4) Vermittlung: kommen die Angebote an?");
  await sleep(8000);
  const gesamtAngebote = angebote.reduce((n, a) => n + a.count(), 0);
  info(`${gesamtAngebote} Angebote an ${fahrer.length} Fahrer verteilt`);
  check("Es wurden Angebote verteilt", gesamtAngebote > 0, gesamtAngebote);

  // Jeder Fahrer nimmt sein erstes Angebot an.
  const annahmeZeiten = [];
  let angenommen = 0;
  await Promise.all(sockets.map(async (s, i) => {
    const a = angebote[i].all()[0];
    if (!a) return;
    const start = ms();
    const r = await new Promise((res) => s.emit("driver:respond", { bookingId: a.id, accept: true }, res));
    annahmeZeiten.push(ms() - start);
    if (r?.ok !== false) angenommen++;
  }));
  info(`${angenommen} Aufträge angenommen`);
  const aT = zeige("Annahme", annahmeZeiten);
  check("Annahme dauert unter 3 s (p95)", aT.p95 < 3000, aT.p95);

  // =========================================================================
  section("5) Dauerbetrieb: GPS-Meldungen (lösen Ankunftszeit-Berechnung aus)");
  const routenVorher = await routenZaehler();
  const gpsStart = ms();
  const RUNDEN = 8;
  for (let runde = 0; runde < RUNDEN; runde++) {
    // Jeder Fahrer bewegt sich spürbar -> jede Meldung darf eine Routenabfrage auslösen.
    sockets.forEach((s, i) => s.emit("driver:location", irgendwo()));
    await sleep(700);
  }
  const gpsDauer = ms() - gpsStart;
  info(`${RUNDEN * sockets.length} GPS-Meldungen in ${gpsDauer} ms abgesetzt`);

  // Während der GPS-Last: bleibt die Anwendung bedienbar?
  const antwortZeiten = [];
  for (let i = 0; i < 10; i++) {
    const start = ms();
    const r = await api("/api/taxis/live");
    antwortZeiten.push(ms() - start);
    check(`Live-Karte antwortet (${i + 1}/10)`, r.status === 200, r.status);
  }
  const lT = zeige("Live-Karte unter GPS-Last", antwortZeiten);
  check("Antwort unter 3 s (p95)", lT.p95 < 3000, lT.p95);

  const preisZeiten = [];
  for (let i = 0; i < 5; i++) {
    const start = ms();
    const q = await post("/api/quote", { from: irgendwo(), to: LIST });
    preisZeiten.push(ms() - start);
    check(`Preisauskunft funktioniert (${i + 1}/5)`, q.status === 200, q.status);
  }
  const pT = zeige("Preisauskunft unter Last", preisZeiten);
  check("Preisauskunft unter 5 s (p95)", pT.p95 < 5000, pT.p95);
  info(`Hinweis: die Preisauskunft nutzt den Kartendienst – hier zeigt sich ein bezahlter Anbieter am deutlichsten.`);

  // =========================================================================
  section("6) Dashboards bleiben bedienbar");
  const dashZeiten = [];
  for (const [pfad, name] of [
    ["/api/admin/overview", "Unternehmens-Kennzahlen"],
    ["/api/admin/drivers", "Fahrerliste"],
    ["/api/admin/payments", "Zahlungen"],
  ]) {
    const start = ms();
    const r = await get(pfad, firmen[0].admin);
    dashZeiten.push(ms() - start);
    check(`${name} lädt unter Last`, r.status === 200, r.status);
  }
  const dT = zeige("Dashboard-Abrufe", dashZeiten);
  check("Dashboard unter 3 s (p95)", dT.p95 < 3000, dT.p95);

  // Kundensicht auf eine laufende Fahrt.
  const beispiel = ok[0]?.body;
  if (beispiel?.trackingToken) {
    const start = ms();
    const t = await get(`/api/bookings/${beispiel.trackingToken}`);
    info(`Verfolgungsseite: ${ms() - start} ms`);
    check("Kunde kann seine Fahrt verfolgen", t.status === 200, t.status);
  }

  // =========================================================================
  section("7) Datenlage nach der Last");
  await sleep(2000);
  const ids = ok.map((b) => b.body?.id).filter(Boolean);
  const alle = await prisma.booking.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, trackingStatus: true, driverId: true, priceApprox: true },
  });
  check("Alle Fahrten sind in der Datenbank", alle.length === ids.length, `${alle.length}/${ids.length}`);

  const zugewiesenOhneFahrer = alle.filter((b) => b.status === "ZUGEWIESEN" && !b.driverId);
  check("Keine zugewiesene Fahrt ohne Fahrer", zugewiesenOhneFahrer.length === 0, zugewiesenOhneFahrer.length);

  const doppelt = new Map();
  for (const b of alle) if (b.driverId) doppelt.set(b.driverId, (doppelt.get(b.driverId) ?? 0) + 1);
  const mehrfach = [...doppelt.entries()].filter(([, n]) => n > 1);
  check("Kein Fahrer hat zwei laufende Fahrten", mehrfach.length === 0, mehrfach.slice(0, 3));

  const ohnePreis = alle.filter((b) => !b.priceApprox);
  check("Jede Fahrt hat eine Preisschätzung", ohnePreis.length === 0, ohnePreis.length);

  const routenNachher = await routenZaehler();
  const gesund = await api("/");
  check("Server ist nach der Last gesund", gesund.status === 200, gesund.status);

  info(`Gesamtdauer: ${Math.round((ms() - t0) / 1000)} s`);
  sockets.forEach((s) => s.close());
  await prisma.$disconnect();
  finish("LASTTEST-GROSS");
}

// Platzhalter: der Server zählt Routenabfragen nicht mit; die Wirkung zeigt
// sich in den Antwortzeiten der Preisauskunft oben.
async function routenZaehler() { return 0; }

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
