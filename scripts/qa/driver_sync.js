// QA: Das Fahrer-Dashboard darf nie ohne Auftragsstand hängen bleiben.
//
// Hintergrund: Der Stand wurde bisher EINMAL beim Verbindungsaufbau gesendet.
// Geht diese Nachricht verloren – Socket.IO schaltet beim Verbinden von Polling
// auf WebSocket um, und genau in diesem Moment kann ein Paket untergehen –,
// wartete der Fahrer endlos auf ein ladendes Dashboard. Ohne Meldung, ohne
// Wiederholung. Im Lasttest traf es 1 von 16 Fahrern.
//
// Geprüft wird:
//  1) Der Fahrer kann seinen Stand jederzeit selbst anfordern (driver:sync)
//  2) Der angeforderte Stand ist vollständig und aktuell
//  3) Auch nach einem Verbindungsabbruch bekommt er wieder einen Stand
//  4) Wiederholtes Anfordern schadet nicht
//  5) Viele Fahrer gleichzeitig bekommen alle einen Stand
//
// Aufruf: node scripts/qa/driver_sync.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep, post, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { io } = require("socket.io-client");

const ANZAHL = 16;

function fahrerSocket(cookie) {
  return io(H.BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: cookie },
                      transports: ["polling", "websocket"], forceNew: true });
}
function warte(sock, ereignis, ms = 10000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout " + ereignis)), ms);
    sock.once(ereignis, (p) => { clearTimeout(t); res(p); });
  });
}

async function main() {
  const co = await H.registerCompany("SYNC");
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });

  // =========================================================================
  section("1) Der Fahrer kann seinen Stand selbst anfordern");
  const drv = await H.createDriver(co.admin, "S", HBF);
  const sock = fahrerSocket(drv.cookie);
  await warte(sock, "connect");
  // Den ersten (gepushten) Stand bewusst verwerfen – hier interessiert nur,
  // ob eine ANFORDERUNG zuverlaessig beantwortet wird.
  await warte(sock, "driver:state").catch(() => null);
  await sleep(300);

  const antwort = await new Promise((res) => {
    const t = setTimeout(() => res(null), 10000);
    sock.emit("driver:sync", {}, (r) => { clearTimeout(t); res(r); });
  });
  check("Anforderung wird bestätigt", antwort?.ok === true, antwort);

  const stand = await new Promise((res) => {
    const t = setTimeout(() => res(null), 10000);
    sock.once("driver:state", (s) => { clearTimeout(t); res(s); });
    sock.emit("driver:sync", {});
  });
  check("Ein Stand wird geliefert", !!stand, stand);
  check("Enthält den Fahrernamen", !!stand?.name, stand?.name);
  check("Enthält den Arbeitsstatus", typeof stand?.status === "string", stand?.status);
  check("Enthält die Liste geplanter Fahrten", Array.isArray(stand?.myScheduled), typeof stand?.myScheduled);
  check("Enthält offene Vorbestellungen", Array.isArray(stand?.openScheduled), typeof stand?.openScheduled);

  // =========================================================================
  section("2) Der angeforderte Stand ist aktuell");
  // Ohne Position kann die Vermittlung den Fahrer nicht zuordnen.
  sock.emit("driver:location", HBF);
  await new Promise((r) => sock.emit("driver:status", { status: "FREI" }, r));
  await sleep(600);
  const fahrt = await post("/api/bookings", {
    company: co.slug, customerName: "Sync Gast", customerPhone: "+4915100000654",
    pickupAddress: "HBF", pickup: HBF, destAddress: "List", dest: LIST, paymentMethod: "CASH",
  });
  const angebote = H.collect(sock, "driver:offer");
  await angebote.match((o) => o.id === fahrt.body?.id, 40000);
  await new Promise((r) => sock.emit("driver:respond", { bookingId: fahrt.body?.id, accept: true }, r));
  await sleep(800);

  const frisch = await new Promise((res) => {
    const t = setTimeout(() => res(null), 10000);
    sock.once("driver:state", (s) => { clearTimeout(t); res(s); });
    sock.emit("driver:sync", {});
  });
  check("Die angenommene Fahrt steht im Stand", frisch?.activeBooking?.id === fahrt.body?.id, frisch?.activeBooking?.id);
  check("Arbeitsstatus ist BESETZT", frisch?.status === "BESETZT", frisch?.status);
  info("Damit findet ein Fahrer nach einem Neuladen seinen laufenden Auftrag wieder.");

  // =========================================================================
  section("3) Nach Verbindungsabbruch gibt es wieder einen Stand");
  sock.disconnect();
  await sleep(600);
  sock.connect();
  await warte(sock, "connect", 10000);
  const nachAbbruch = await new Promise((res) => {
    const t = setTimeout(() => res(null), 10000);
    sock.once("driver:state", (s) => { clearTimeout(t); res(s); });
    sock.emit("driver:sync", {});
  });
  check("Stand kommt nach Wiederverbinden", !!nachAbbruch, nachAbbruch?.status);
  check("Der laufende Auftrag ist noch da", nachAbbruch?.activeBooking?.id === fahrt.body?.id, nachAbbruch?.activeBooking?.id);

  // =========================================================================
  section("4) Mehrfaches Anfordern schadet nicht");
  const mehrfach = await Promise.all(Array.from({ length: 5 }, () => new Promise((res) => {
    const t = setTimeout(() => res(null), 10000);
    sock.emit("driver:sync", {}, (r) => { clearTimeout(t); res(r); });
  })));
  check("Alle fünf Anforderungen beantwortet", mehrfach.every((r) => r?.ok === true), mehrfach);
  const danach = await prisma.booking.findUnique({
    where: { id: fahrt.body?.id }, select: { status: true, driverId: true },
  });
  check("Die Fahrt bleibt unverändert", danach?.driverId === drv.driverId && danach?.status === "ZUGEWIESEN", danach);

  for (const a of ["arrived", "start", "complete"]) {
    await new Promise((r) => sock.emit("driver:trip", { bookingId: fahrt.body?.id, action: a }, r));
    await sleep(250);
  }
  sock.close();

  // =========================================================================
  section(`5) ${ANZAHL} Fahrer gleichzeitig – jeder bekommt einen Stand`);
  const viele = [];
  for (let i = 0; i < ANZAHL; i++) {
    const d = await H.createDriver(co.admin, `V${i}`, HBF);
    if (d.cookie) viele.push(d);
  }
  check(`${ANZAHL} Fahrer angelegt`, viele.length === ANZAHL, `${viele.length}/${ANZAHL}`);

  const ergebnisse = await Promise.all(viele.map((d, idx) => new Promise((res) => {
    const s = fahrerSocket(d.cookie);
    const t0 = Date.now();
    let fertig = false;
    const spur = { verbunden: null, fehler: null, versuche: 0 };
    s.on("connect", () => { spur.verbunden = Date.now() - t0; });
    s.on("connect_error", (e) => { spur.fehler = e.message; });
    const abschluss = (ok) => {
      if (fertig) return;
      fertig = true;
      if (!ok) info(`  Fahrer ${idx + 1} ohne Stand: connect=${spur.verbunden ?? "NIE"} ms, ` +
                    `Nachfragen=${spur.versuche}, Fehler=${spur.fehler ?? "keiner"}`);
      s.close(); res(ok);
    };
    s.once("driver:state", () => abschluss(true));
    // Genau wie im Dashboard: aktiv nachfragen, falls der Push ausbleibt.
    s.on("connect", () => { s.emit("driver:location", HBF); s.emit("driver:sync", {}); });
    // Genau wie im Dashboard: zweimal nachfragen, dann die Verbindung neu
    // aufbauen. Auf einem still gestorbenen Socket kommt eine Anfrage nicht an.
    let n = 0;
    const nachfassen = setInterval(() => {
      if (fertig) { clearInterval(nachfassen); return; }
      n += 1;
      spur.versuche = n;
      if (n <= 2) s.emit("driver:sync", {});
      else if (n === 3) { s.disconnect(); s.connect(); }
      else if (n > 6) clearInterval(nachfassen);
    }, 2500);
    setTimeout(() => { clearInterval(nachfassen); abschluss(false); }, 20000);
  })));
  const ok = ergebnisse.filter(Boolean).length;
  check("JEDER Fahrer bekommt seinen Stand", ok === viele.length, `${ok}/${viele.length}`);
  info("Ohne Nachfassen blieb im Lasttest 1 von 16 Fahrern ohne Stand hängen.");

  await prisma.$disconnect();
  finish("FAHRER-STAND-ABSICHERUNG");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
