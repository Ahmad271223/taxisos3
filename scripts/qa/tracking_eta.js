// QA: Sieht der Kunde den Fahrer, und ist die Ankunftszeit echt?
//
// Zwei Fragen:
//   A) Wird die Fahrerposition durchgehend an den Kunden übertragen –
//      insbesondere auf der ANFAHRT, nicht erst ab Einsteigen?
//   B) Ist die angezeigte Ankunftszeit eine echte Routenberechnung, und
//      aktualisiert sie sich, während der Fahrer näher kommt?
//
// Aufruf: node scripts/qa/tracking_eta.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep, post, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Punkte auf der Anfahrt: weit weg -> nah dran.
// Der Dispatch sucht in Stufen (500 m -> 1 -> 2 -> 3 -> 5 km). Der Startpunkt
// muss also innerhalb von 5 km liegen, sonst kommt nie ein Angebot.
const WEIT = { lat: 52.3615, lng: 9.7320 };   // ~1,6 km südlich (Stufe 3)
const MITTE = { lat: 52.3690, lng: 9.7320 };  // ~0,8 km
const NAH = { lat: 52.3750, lng: 9.7325 };    // ~100 m

async function main() {
  const co = await H.registerCompany("TRACK");
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });
  const drv = await H.createDriver(co.admin, "T", WEIT);
  const dsock = await H.goOnline(drv.cookie, WEIT);
  const offers = H.collect(dsock, "driver:offer");

  const b = await post("/api/bookings", {
    company: co.slug, customerName: "Track Test", customerPhone: "+4915100000123",
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH",
  });
  check("Fahrt gebucht", b.status === 201, b.body?.error);
  const bookingId = b.body?.id;
  const token = b.body?.booking?.trackingToken ?? b.body?.trackingToken ?? bookingId;

  // Der Kunde verfolgt die Fahrt – genau wie im Browser auf /verfolgen/<token>.
  // Gast-Verbindung wie im Browser: OHNE Cookie-Header (H.connectSocket setzt
  // sonst "Cookie: undefined", was den Verbindungsaufbau haengen laesst).
  const { io: ioClient } = require("socket.io-client");
  const ksock = ioClient(H.BASE, { transports: ["polling", "websocket"], forceNew: true });
  await H.waitFor(ksock, "connect", 8000);
  const positionen = H.collect(ksock, "booking:driverLocation");
  const updates = H.collect(ksock, "booking:update");
  const etas = H.collect(ksock, "booking:eta");
  await H.emitAck(ksock, "track:join", { bookingId: token });
  await sleep(400);

  // =========================================================================
  section("A) Fahrerposition während der ANFAHRT");
  await offers.match((o) => o.id === bookingId, 70000); // Stufensuche braucht bis zu 45 s
  await H.emitAck(dsock, "driver:respond", { bookingId, accept: true });
  await sleep(800);

  const nachAnnahme = await prisma.booking.findUnique({
    where: { id: bookingId }, select: { trackingStatus: true },
  });
  check("Fahrt steht auf 'Fahrer unterwegs'", nachAnnahme?.trackingStatus === "FAHRER_UNTERWEGS", nachAnnahme?.trackingStatus);

  const vorher = positionen.all().length;
  // Fahrer bewegt sich Richtung Kunde.
  for (const p of [WEIT, MITTE, NAH]) {
    dsock.emit("driver:location", { lat: p.lat, lng: p.lng });
    await sleep(700);
  }
  const empfangen = positionen.all().slice(vorher);
  check("Kunde empfängt Positionen schon auf der Anfahrt", empfangen.length >= 3, empfangen.length);
  const letzte = empfangen[empfangen.length - 1];
  check("Position gehört zu dieser Fahrt", letzte?.bookingId === bookingId, letzte?.bookingId);
  check("Position ist die zuletzt gesendete", Math.abs((letzte?.lat ?? 0) - NAH.lat) < 0.001, letzte);
  info(`${empfangen.length} Positionsmeldungen während der Anfahrt empfangen`);

  // =========================================================================
  section("B) Ist die Ankunftszeit echt gerechnet?");
  const alle = updates.all();
  const mitEta = alle.filter((u) => u.etaSeconds != null);
  const ersteEta = mitEta.length ? mitEta[mitEta.length - 1].etaSeconds : null;
  check("Überhaupt eine Ankunftszeit geliefert", ersteEta != null, ersteEta);
  if (ersteEta != null) {
    info(`Ankunftszeit bei Annahme: ${Math.round(ersteEta / 60)} Min`);
    // Luftlinie WEIT -> Abholpunkt sind rund 8 km. Eine Fahrzeit unter 2 Min
    // waere unrealistisch, ueber 90 Min ebenso.
    check("Wert ist plausibel (1-40 Min)", ersteEta > 45 && ersteEta < 2400, ersteEta);
  }

  // Prüfen, ob eine echte Route (Strassenverlauf) oder nur Luftlinie gerechnet wird.
  const quote = await post("/api/quote", { from: WEIT, to: HBF });
  const meter = quote.body?.distanceMeters ?? null;
  const km = meter != null ? Math.round(meter) / 1000 : null;
  const dauer = quote.body?.durationSeconds ?? null;
  const geo = quote.body?.geometry ?? null;
  check("Routenberechnung liefert eine Strecke", km != null, meter);
  check("Und eine Fahrzeit", dauer != null && dauer > 0, dauer);
  check("Route folgt echten Straßen (mehr als 2 Punkte)",
    Array.isArray(geo) ? geo.length > 2 : false,
    Array.isArray(geo) ? `${geo.length} Punkte` : typeof geo);
  if (km != null) {
    const luftlinie = 1.6;
    info(`Strecke ${km} km bei ~${luftlinie} km Luftlinie (Umweg-Faktor ${(km / luftlinie).toFixed(2)})`);
  }

  // =========================================================================
  section("C) Aktualisiert sich die Ankunftszeit auf der Anfahrt?");
  const etaVor = mitEta.length ? mitEta[mitEta.length - 1].etaSeconds : null;
  const zaehlerVor = updates.all().length;
  // Fahrer fährt weiter dicht an den Kunden heran.
  for (let i = 0; i < 4; i++) {
    dsock.emit("driver:location", { lat: HBF.lat + 0.002, lng: HBF.lng + 0.002 });
    await sleep(800);
  }
  await sleep(1500);
  const ausUpdates = updates.all().slice(zaehlerVor).filter((u) => u.etaSeconds != null);
  const ausEta = etas.all();
  const neue = [...ausUpdates.map((u) => u.etaSeconds), ...ausEta.map((e) => e.etaSeconds)];
  const etaNach = neue.length ? neue[neue.length - 1] : null;
  info(`Ankunftszeit vorher: ${etaVor != null ? Math.round(etaVor / 60) + " Min" : "—"}, ` +
       `nach Annäherung: ${etaNach != null ? Math.round(etaNach / 60) + " Min" : "keine Aktualisierung"}`);
  check("Ankunftszeit wird bei Annäherung neu berechnet", etaNach != null, `${neue.length} Aktualisierungen`);
  if (etaNach != null && etaVor != null) {
    check("Und sie wird kleiner, je näher der Fahrer kommt", etaNach < etaVor, { vorher: etaVor, nachher: etaNach });
  }

  // =========================================================================
  section("D) Position auch WÄHREND der Fahrt");
  for (const a of ["arrived", "start"]) {
    await H.emitAck(dsock, "driver:trip", { bookingId, action: a });
    await sleep(400);
  }
  const vorFahrt = positionen.all().length;
  dsock.emit("driver:location", { lat: LIST.lat - 0.004, lng: LIST.lng - 0.004 });
  await sleep(900);
  check("Kunde sieht den Wagen auch während der Fahrt",
    positionen.all().length > vorFahrt, positionen.all().length - vorFahrt);

  await H.emitAck(dsock, "driver:trip", { bookingId, action: "complete" });
  await sleep(600);

  dsock.close();
  ksock.close();
  await prisma.$disconnect();
  finish("VERFOLGUNG-UND-ANKUNFTSZEIT");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
