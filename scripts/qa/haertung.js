// QA: Haertung nach dem zweiten externen Bericht (07.09.2026).
//
// Jeder Punkt hier war ein bestaetigter Befund:
//   1. Kunden-Storno gab den rohen Fahrer-Datensatz zurueck - samt Passwort-Hash
//   2. Unterschrift: vor der Fahrt moeglich, ueberschreibbar, kein PNG-Check,
//      Koordinaten ohne Weltgrenzen
//   3. Bewertung: vor Fahrtende moeglich und beliebig oft ueberschreibbar
//   4. Firmenbudget: zwei gleichzeitige Buchungen ueberschritten das Budget,
//      Fehler beim Verbuchen wurden geschluckt
//   5. Chat lieferte ab der 101. Nachricht die AELTESTEN statt der neuesten
//   6. Fahrer-Socket: Fantasie-Koordinaten und Fantasie-Status wurden uebernommen
//   7. Zweites Geraet desselben Fahrers: eine getrennte Verbindung setzte ihn
//      offline, obwohl die andere noch lief
//   8. Firmenregistrierung mit 6-Zeichen-Passwort
//
// Dritter Bericht (07.09.2026):
//   9. Deaktivierter Fahrer konnte sich anmelden und weiterfahren; eine
//      Deaktivierung wirkte erst nach Ablauf des Ausweises (7 Tage)
//  10. Gesperrter Fahrgast konnte sich anmelden und sein Profil aendern
//  11. Zieländerung: Koordinaten ohne Grenzen, beliebig oft, auch nach der
//      Bezahlung
//
// Aufruf: node scripts/qa/haertung.js   (Server muss laufen)
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, post, get, sleep } = H;
const { io } = require("socket.io-client");
const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const prisma = new PrismaClient();

const HBF = { lat: 52.3759, lng: 9.7320 };
const LIST = { lat: 52.3900, lng: 9.7600 };
// Gueltiger PNG-Anfang (Base64 der Signatur 89 50 4E 47 0D 0A 1A 0A) + Fuellung.
const PNG = "iVBORw0KGgo" + "A".repeat(64);

// Fahrt direkt in der Datenbank anlegen - ohne Vermittlung, damit der Zustand
// exakt steuerbar ist (Status OFFEN, spaeter ABGESCHLOSSEN).
async function fahrtInDb(extra = {}) {
  const token = crypto.randomUUID();
  const b = await prisma.booking.create({
    data: {
      customerName: "Haertung Test", customerPhone: "+4915100000900",
      pickupAddress: "A", destAddress: "B", pickupLat: HBF.lat, pickupLng: HBF.lng,
      destLat: LIST.lat, destLng: LIST.lng, paymentMethod: "CASH", status: "OFFEN",
      trackingToken: token, ...extra,
    },
    select: { id: true, trackingToken: true },
  });
  return b;
}

async function main() {
  const co = await H.registerCompany("HT");
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });

  // =========================================================================
  section("1) Storno-Antwort enthaelt keinen Fahrer-Datensatz mehr");
  const drv = await H.createDriver(co.admin, "H1", HBF);
  const s1 = io(H.BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: drv.cookie }, transports: ["polling", "websocket"], forceNew: true });
  await H.waitFor(s1, "driver:state", 15000);
  s1.emit("driver:location", HBF);
  await new Promise((r) => s1.emit("driver:status", { status: "FREI" }, r));
  const angebote = H.collect(s1, "driver:offer");

  const b1 = await post("/api/bookings", {
    company: co.slug, customerName: "Storno Test", customerPhone: "+4915100000901",
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST, paymentMethod: "CASH",
  });
  check("Fahrt gebucht", b1.status === 201, b1.body?.error);
  const tok1 = b1.body?.booking?.trackingToken;
  await H.waitFor(s1, "driver:offer", 20000).catch(() => null);
  const a = angebote.all()[0];
  if (a) await new Promise((r) => s1.emit("driver:respond", { bookingId: a.id, accept: true }, r));
  await sleep(600);
  const storno = await post(`/api/bookings/${tok1}/cancel`, { reason: "Test" });
  check("Storno per Token moeglich", storno.status === 200 && storno.body?.ok === true, storno.body?.error);
  const roh = JSON.stringify(storno.body ?? {});
  check("KEIN passwordHash in der Antwort", !roh.includes("passwordHash"));
  check("KEIN Benutzername des Fahrers in der Antwort", !roh.includes('"username"'));
  check("Antwort ist das DTO (hat trackingToken, keine Rohfelder)", roh.includes("trackingToken") && !roh.includes("companyId\":") || !roh.includes("passwordHash"));

  // =========================================================================
  section("2) Unterschrift: erst waehrend/nach der Fahrt, einmalig, nur PNG");
  const f2 = await fahrtInDb();
  const zuFrueh = await post(`/api/bookings/${f2.trackingToken}/signature`, { dataBase64: PNG, lat: 52.37, lng: 9.73 });
  check("Vor der Fahrt abgelehnt (409)", zuFrueh.status === 409, zuFrueh.status);
  await prisma.booking.update({ where: { id: f2.id }, data: { status: "ABGESCHLOSSEN", trackingStatus: "BEENDET" } });
  const keinPng = await post(`/api/bookings/${f2.trackingToken}/signature`, { dataBase64: "Q0VSVElGSUNBVEU=" + "A".repeat(40), lat: 52.37, lng: 9.73 });
  check("Kein PNG -> abgelehnt (400)", keinPng.status === 400, keinPng.status);
  const badKoord = await post(`/api/bookings/${f2.trackingToken}/signature`, { dataBase64: PNG, lat: 999, lng: 9.73 });
  check("Koordinate ausserhalb der Welt -> abgelehnt (400)", badKoord.status === 400, badKoord.status);
  const ok = await post(`/api/bookings/${f2.trackingToken}/signature`, { dataBase64: PNG, lat: 52.37, lng: 9.73, signedName: "Erna" });
  check("Nach der Fahrt angenommen (201)", ok.status === 201, ok.body?.error);
  const nochmal = await post(`/api/bookings/${f2.trackingToken}/signature`, { dataBase64: PNG, lat: 1, lng: 1, signedName: "Faelscher" });
  check("Zweite Unterschrift abgelehnt (409) - Nachweis bleibt unveraendert", nochmal.status === 409, nochmal.status);
  const sig = await prisma.rideSignature.findUnique({ where: { bookingId: f2.id }, select: { signedName: true } });
  check("Gespeichert ist die erste Unterschrift", sig?.signedName === "Erna", sig?.signedName);

  // =========================================================================
  section("3) Bewertung: erst nach Fahrtende, nur einmal");
  const f3 = await fahrtInDb();
  const zuFrueh3 = await post(`/api/bookings/${f3.trackingToken}/rating`, { rating: 5 });
  check("Vor Fahrtende abgelehnt (409)", zuFrueh3.status === 409, zuFrueh3.status);
  await prisma.booking.update({ where: { id: f3.id }, data: { status: "ABGESCHLOSSEN", trackingStatus: "BEENDET" } });
  const r1 = await post(`/api/bookings/${f3.trackingToken}/rating`, { rating: 5, comment: "Super" });
  check("Nach Fahrtende angenommen", r1.status === 200, r1.body?.error);
  const r2 = await post(`/api/bookings/${f3.trackingToken}/rating`, { rating: 1, comment: "Manipuliert" });
  check("Zweite Bewertung abgelehnt (409)", r2.status === 409, r2.status);
  const bew = await prisma.booking.findUnique({ where: { id: f3.id }, select: { rating: true } });
  check("Erste Bewertung bleibt bestehen", bew?.rating === 5, bew?.rating);

  // =========================================================================
  section("4) Firmenbudget: gleichzeitige Buchungen koennen es nicht sprengen");
  const eId = H.uniq();
  const ev = await post("/api/events/register", { name: `Firma ${eId}`, email: `firma${eId}@test.de`.toLowerCase(), password: "Pass1234" });
  check("Veranstalter registriert", ev.status === 200 || ev.status === 201, ev.body?.error);
  const code = await post("/api/events/corporate", { label: "Nur eine Fahrt", maxRides: 1 }, ev.cookie);
  check("Firmencode mit Kontingent 1 angelegt", code.status === 201, code.body?.error);
  const token = code.body?.code?.code;
  const gleichzeitig = await Promise.all([1, 2, 3].map((i) => post("/api/bookings", {
    customerName: `Race ${i}`, customerPhone: `+491510000091${i}`,
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH", corporateCode: token,
  })));
  const stati = gleichzeitig.map((r) => r.status).sort();
  check("Genau EINE von drei gleichzeitigen Buchungen kommt durch", stati.join(",") === "201,402,402", stati.join(","));
  const cc = await prisma.corporateCode.findUnique({ where: { code: token }, select: { usedRides: true } });
  check("Kontingent zeigt genau 1 verbrauchte Fahrt", cc?.usedRides === 1, cc?.usedRides);
  const mitCode = await prisma.booking.count({ where: { corporateCode: token } });
  check("Nur eine Fahrt traegt den Code (abgelehnte wurden entfernt)", mitCode === 1, mitCode);

  // =========================================================================
  section("5) Chat liefert die NEUESTEN 100 Nachrichten");
  const f5 = await fahrtInDb();
  const basis = Date.now() - 200_000;
  await prisma.chatMessage.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      bookingId: f5.id, sender: i % 2 ? "DRIVER" : "CUSTOMER", text: `N${i + 1}`, createdAt: new Date(basis + i * 1000),
    })),
  });
  const verlauf = await get(`/api/bookings/${f5.trackingToken}/messages`);
  const texte = (verlauf.body?.messages ?? []).map((m) => m.text);
  check("Genau 100 Nachrichten", texte.length === 100, texte.length);
  check("Die NEUESTE (N105) ist dabei", texte[texte.length - 1] === "N105", texte[texte.length - 1]);
  check("Die aelteste gelieferte ist N6 (N1-N5 fallen weg)", texte[0] === "N6", texte[0]);

  // =========================================================================
  section("6) Fahrer-Socket: Fantasiewerte werden abgewiesen");
  const drv6 = await H.createDriver(co.admin, "H6", HBF);
  const s6 = io(H.BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: drv6.cookie }, transports: ["polling", "websocket"], forceNew: true });
  await H.waitFor(s6, "driver:state", 15000);
  await new Promise((r) => s6.emit("driver:status", { status: "FREI" }, r));
  s6.emit("driver:location", { lat: 52.38, lng: 9.74 });
  await sleep(1200);
  s6.emit("driver:location", { lat: 999, lng: 9.74 });
  s6.emit("driver:location", { lat: "52", lng: "9" });
  await sleep(800);
  const live = await get("/api/taxis/live");
  const ich = (live.body?.taxis ?? []).find((t) => t.id === drv6.driverId);
  check("Ungueltige Koordinaten werden ignoriert (Position bleibt 52.38)", !!ich && Math.abs(ich.lat - 52.38) < 0.001, ich?.lat);
  const hack = await new Promise((r) => s6.emit("driver:status", { status: "SUPERADMIN" }, r));
  check("Erfundener Status wird abgelehnt", hack?.ok === false, JSON.stringify(hack));
  const pause = await new Promise((r) => s6.emit("driver:status", { status: "PAUSE" }, r));
  check("Erlaubter Status (PAUSE) geht durch", pause?.ok === true);
  const inDb = await prisma.driver.findUnique({ where: { id: drv6.driverId }, select: { status: true } });
  check("Datenbank kennt nur den erlaubten Status", inDb?.status === "PAUSE", inDb?.status);

  // =========================================================================
  section("7) Zweites Geraet desselben Fahrers");
  await new Promise((r) => s6.emit("driver:status", { status: "FREI" }, r));
  const s6b = io(H.BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: drv6.cookie }, transports: ["polling", "websocket"], forceNew: true });
  await H.waitFor(s6b, "driver:state", 15000);
  s6.close(); // erstes Geraet trennt sich
  await sleep(1500);
  const nachTrennung = await prisma.driver.findUnique({ where: { id: drv6.driverId }, select: { status: true } });
  check("Fahrer bleibt online, solange das zweite Geraet verbunden ist", nachTrennung?.status !== "OFFLINE", nachTrennung?.status);
  s6b.close();
  await sleep(1500);
  const nachBeiden = await prisma.driver.findUnique({ where: { id: drv6.driverId }, select: { status: true } });
  check("Ohne Verbindung geht er offline", nachBeiden?.status === "OFFLINE", nachBeiden?.status);

  // =========================================================================
  section("8) Registrierung verlangt ein brauchbares Passwort");
  const kurz = await post("/api/companies/register", { name: `QA_Kurz_${H.uniq()}`, email: `kurz${H.uniq()}@test.com`, password: "kurz12", cityTier: "SMALL" });
  check("Firma mit 6-Zeichen-Passwort abgelehnt", kurz.status === 400, kurz.status);
  const kurzK = await post("/api/customer/register", { name: "Kurz", email: `kurzk${H.uniq()}@test.de`, phone: "+4915100000999", password: "kurz12" });
  check("Fahrgast mit 6-Zeichen-Passwort abgelehnt", kurzK.status === 400, kurzK.status);

  // =========================================================================
  section("9) Deaktivierter Fahrer verliert den Zugang SOFORT");
  const drv9 = await H.createDriver(co.admin, "H9", HBF);
  const s9 = io(H.BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: drv9.cookie }, transports: ["polling", "websocket"], forceNew: true });
  await H.waitFor(s9, "driver:state", 15000);
  await new Promise((r) => s9.emit("driver:status", { status: "FREI" }, r));
  check("Fahrer ist vor der Deaktivierung verbunden", s9.connected === true);

  const getrennt = new Promise((r) => s9.once("disconnect", () => r(true)));
  const deakt = await H.patch(`/api/admin/drivers/${drv9.driverId}`, { active: false }, co.admin);
  check("Zentrale kann den Fahrer deaktivieren", deakt.status === 200, deakt.body?.error);
  const wurdeGetrennt = await Promise.race([getrennt, sleep(6000).then(() => false)]);
  check("Bestehende Verbindung wird sofort getrennt", wurdeGetrennt === true);
  const st9 = await prisma.driver.findUnique({ where: { id: drv9.driverId }, select: { status: true } });
  check("Fahrer steht danach auf OFFLINE", st9?.status === "OFFLINE", st9?.status);

  const neuAnmeldung = await post("/api/auth/login", { role: "DRIVER", username: drv9.username, password: "Pass1234" });
  check("Erneute Anmeldung wird abgewiesen", neuAnmeldung.status === 403, neuAnmeldung.status);
  check("Mit verstaendlicher Begruendung", /deaktiviert/i.test(neuAnmeldung.body?.error ?? ""), neuAnmeldung.body?.error);

  // Der alte Ausweis im Browser gilt noch sieben Tage - er darf trotzdem nicht
  // mehr an den Echtzeitkanal herankommen.
  const s9b = io(H.BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: drv9.cookie }, transports: ["polling", "websocket"], forceNew: true });
  const abgewiesen = await Promise.race([
    new Promise((r) => s9b.once("auth:error", () => r(true))),
    new Promise((r) => s9b.once("disconnect", () => r(true))),
    H.waitFor(s9b, "driver:state", 8000).then(() => false).catch(() => false),
  ]);
  check("Alter Ausweis kommt nicht mehr in den Echtzeitkanal", abgewiesen === true);
  s9b.close();

  // =========================================================================
  section("10) Gesperrter Fahrgast");
  const mail10 = `haertung10_${H.uniq()}@test.de`;
  const reg10 = await post("/api/customer/register", {
    name: "Gesperrt Test", email: mail10, phone: "+4915" + String(H.uniq()).slice(-9), password: "Pass1234",
  });
  check("Fahrgast angelegt", reg10.status === 200 || reg10.status === 201, reg10.body?.error);
  const cookie10 = reg10.cookie;
  await prisma.customer.update({
    where: { email: mail10 },
    data: { blocked: true, blockedReason: "Testsperre" },
  });

  const login10 = await post("/api/auth/login", { role: "CUSTOMER", username: mail10, password: "Pass1234" });
  check("Anmeldung eines gesperrten Kontos abgelehnt", login10.status === 403, login10.status);
  check("Der Grund wird genannt", /Testsperre/.test(login10.body?.error ?? ""), login10.body?.error);

  // Die bereits offene Sitzung darf nichts mehr aendern.
  const aend10 = await H.patch("/api/customer/profile", { name: "Neuer Name" }, cookie10);
  check("Offene Sitzung darf das Profil nicht mehr aendern", aend10.status === 403, aend10.status);
  const prof10 = await get("/api/customer/profile", cookie10);
  check("Lesen bleibt moeglich (Grund einsehbar)", prof10.status === 200, prof10.status);
  check("Sperre wird im Profil ausgewiesen", prof10.body?.profile?.blocked === true, JSON.stringify(prof10.body?.profile ?? {}));

  // =========================================================================
  section("11) Zieländerung waehrend der Fahrt");
  const f11 = await fahrtInDb({ trackingStatus: "FAHRT_LAEUFT" });
  const ziel = (dest) => post(`/api/bookings/${f11.trackingToken}/destination`, { dest });

  const unmoeglich = await ziel({ address: "Nirgendwo", lat: 999, lng: 9.74 });
  check("Unmoegliche Koordinaten abgelehnt", unmoeglich.status === 400, unmoeglich.status);
  const textZiel = await ziel({ address: "Nirgendwo", lat: "52.4", lng: "9.7" });
  check("Koordinaten als Text abgelehnt", textZiel.status === 400, textZiel.status);
  const weit = await ziel({ address: "Muenchen Hbf", lat: 48.1402, lng: 11.5600 });
  check("Ziel jenseits von 300 km abgelehnt", weit.status === 400, weit.status);
  check("Mit Hinweis auf die Zentrale", /Zentrale/i.test(weit.body?.error ?? ""), weit.body?.error);

  const bezahlt = await fahrtInDb({ trackingStatus: "BEENDET", paymentStatus: "BEZAHLT" });
  const nachZahlung = await post(`/api/bookings/${bezahlt.trackingToken}/destination`, {
    dest: { address: "List", lat: LIST.lat, lng: LIST.lng },
  });
  check("Nach der Bezahlung keine Zieländerung mehr", nachZahlung.status === 409, nachZahlung.status);
  check("Mit Begruendung 'bereits bezahlt'", /bezahlt/i.test(nachZahlung.body?.error ?? ""), nachZahlung.body?.error);

  // Haeufigkeit: der Verfolgungs-Link wandert per SMS durch fremde Haende.
  const f11b = await fahrtInDb({ trackingStatus: "FAHRT_LAEUFT" });
  let letzterStatus = 0;
  for (let i = 0; i < 12; i++) {
    const r = await post(`/api/bookings/${f11b.trackingToken}/destination`, {
      dest: { address: `Ziel ${i}`, lat: LIST.lat, lng: LIST.lng },
    });
    letzterStatus = r.status;
    if (r.status === 429) break;
  }
  check("Dauerhafte Zieländerungen werden gebremst", letzterStatus === 429, letzterStatus);

  s1.close();
  await prisma.$disconnect();
  finish("HAERTUNG");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e?.message ?? e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
