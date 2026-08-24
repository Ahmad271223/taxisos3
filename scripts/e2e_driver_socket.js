// E2E: kompletter Fahrtlebenszyklus mit echtem Socket.IO-Fahrer-Client.
// Verifiziert Phase 2:
//  - Mehrziel-Buchung (stops) -> priceExact nach Annahme ueber die Gesamtroute
//  - driver:changeDest (Zwischenstopp waehrend der Fahrt, Neuberechnung)
//  - Stripe Capture bei complete (Mock-Modus ohne Key: AUTORISIERT -> BEZAHLT)
// Aufruf: node scripts/e2e_driver_socket.js [baseUrl]
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");

const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };
const AEGI = { lat: 52.368, lng: 9.745 };

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? " -> " + JSON.stringify(extra) : ""}`);
  }
}

async function api(path, opts = {}, cookie) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body, cookie: setCookie ? setCookie.split(";")[0] : null };
}

function waitFor(socket, event, timeoutMs = 25000, filter = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      if (!filter(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

// Puffert ALLE Events eines Typs ab Verbindungsbeginn und erlaubt das spaetere
// Warten auf ein passendes (z. B. genau unsere bookingId) – robust gegen fremde
// Angebote aus Alt-Bestaenden der Test-DB.
function collect(socket, event) {
  const buf = [];
  const waiters = [];
  socket.on(event, (p) => {
    const i = waiters.findIndex((w) => w.filter(p));
    if (i >= 0) {
      const w = waiters.splice(i, 1)[0];
      clearTimeout(w.timer);
      w.resolve(p);
    } else buf.push(p);
  });
  return {
    match(filter, timeoutMs = 25000) {
      const i = buf.findIndex(filter);
      if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = {
          filter,
          resolve,
          timer: setTimeout(() => {
            const j = waiters.indexOf(w);
            if (j >= 0) waiters.splice(j, 1);
            reject(new Error(`timeout waiting for ${event}`));
          }, timeoutMs),
        };
        waiters.push(w);
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ts = Date.now();

  // 1) Firma registrieren + Fahrer anlegen + Fahrer-Login
  console.log("1) Setup: Firma + Fahrer");
  const reg = await api("/api/companies/register", {
    method: "POST",
    body: JSON.stringify({
      name: `TEST_E2E_${ts}`,
      email: `e2e+${ts}@test.com`,
      password: "Pass1234",
      cityTier: "SMALL",
    }),
  });
  check("company registered", reg.status === 200 || reg.status === 201, reg.body);
  const adminCookie = reg.cookie;

  const drv = await api(
    "/api/admin/drivers",
    {
      method: "POST",
      body: JSON.stringify({
        name: "E2E Fahrer",
        username: `e2edrv${ts}`,
        password: "Pass1234",
        vehicleModel: "Tesla Model 3",
        vehiclePlate: "H-E2E 1",
        vehicleColor: "Weiß",
      }),
    },
    adminCookie,
  );
  check("driver created", drv.status === 200 || drv.status === 201, drv.body);

  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: `e2edrv${ts}`, password: "Pass1234" }),
  });
  check("driver login", login.status === 200 && login.body?.role === "DRIVER", login.body);
  const driverCookie = login.cookie;

  // 2) Socket verbinden, FREI melden, Standort senden
  console.log("2) Fahrer-Socket verbinden + FREI + GPS");
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: driverCookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect", 15000);
  await waitFor(socket, "driver:state", 15000);
  socket.emit("driver:location", HBF);
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  await sleep(500);

  // 3) Telefon verifizieren (Phase 3h) -> CARD-Buchung mit Zwischenstopp
  console.log("3) Telefon verifizieren + CARD-Buchung mit Stopp aufgeben");
  const phone = "0511777" + (ts % 1000);
  const vReq = await api("/api/verify/request", {
    method: "POST",
    body: JSON.stringify({ channel: "SMS", target: phone }),
  });
  check("verify devCode (mock)", !!vReq.body?.devCode, vReq.body);
  const vCon = await api("/api/verify/confirm", {
    method: "POST",
    body: JSON.stringify({ channel: "SMS", target: phone, code: vReq.body.devCode }),
  });
  check("verify token issued", !!vCon.body?.token, vCon.body);
  const verificationToken = vCon.body && vCon.body.token;

  const offers = collect(socket, "driver:offer");
  const bk = await api("/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      customerName: "E2E Kunde",
      customerPhone: phone,
      pickupAddress: "HBF Hannover",
      pickup: HBF,
      destAddress: "Kröpcke",
      dest: KROEPCKE,
      stops: [{ address: "Aegidientorplatz", ...AEGI }],
      // Seit der Zahlungsumstellung braucht Kartenzahlung ein angemeldetes
      // Konto mit hinterlegter Karte. Dieser Test prueft die Fahrer-Verbindung,
      // nicht die Zahlung -> Barzahlung.
      paymentMethod: "CASH",
      verificationToken,
    }),
  });
  check("booking created", bk.status === 201, bk.body);
  const bid = bk.body.id;
  // Frueher wurde beim Buchen ein Hold gesetzt (AUTORISIERT). Das Hold-Modell
  // ist abgeschafft: es wird beim Buchen NICHTS reserviert. Bei Barzahlung
  // bleibt die Zahlung bis zum Fahrtende offen.
  check("no money touched at booking", bk.body.booking.paymentStatus === "OFFEN", bk.body.booking.paymentStatus);
  check("nothing reserved at booking", !bk.body.booking.priceAuthorized, bk.body.booking.priceAuthorized);
  const offer = await offers.match((o) => o.id === bid, 30000);
  check("offer received for our booking", offer.id === bid, offer.id);
  check("offer contains stops", Array.isArray(offer.stops) && offer.stops.length === 1, offer.stops);

  // 4) Annehmen -> priceExact ueber Gesamtroute (mit Stopp)
  console.log("4) Angebot annehmen");
  const ack = await new Promise((res) => socket.emit("driver:respond", { bookingId: bid, accept: true }, res));
  check("accept ack ok", ack && ack.ok === true, ack);
  await sleep(800);
  let b = (await api(`/api/bookings/${bid}`)).body;
  check("status ZUGEWIESEN", b.status === "ZUGEWIESEN", b.status);
  check("trackingStatus FAHRER_UNTERWEGS", b.trackingStatus === "FAHRER_UNTERWEGS", b.trackingStatus);
  check("priceExact fixed after accept", typeof b.priceExact === "number" && b.priceExact > 0, b.priceExact);
  const priceExactBefore = b.priceExact;

  // 4b) Chat-Roundtrip (Phase 3i): anonymer Kunden-Socket <-> Fahrer
  console.log("4b) Chat Kunde <-> Fahrer");
  const customer = io(BASE, { transports: ["websocket", "polling"], forceNew: true });
  await waitFor(customer, "connect", 15000);
  await new Promise((res) => customer.emit("track:join", { bookingId: bid }, res));
  const custRecv = waitFor(customer, "chat:message", 15000, (m) => m.sender === "DRIVER");
  const dAck = await new Promise((res) =>
    socket.emit("chat:send", { bookingId: bid, text: "Bin in 2 Minuten da." }, res),
  );
  check("driver chat:send ack ok", dAck && dAck.ok === true, dAck);
  const custMsg = await custRecv;
  check("customer received driver msg", custMsg.text === "Bin in 2 Minuten da.", custMsg);
  const drvRecv = waitFor(socket, "chat:message", 15000, (m) => m.sender === "CUSTOMER");
  const cAck = await new Promise((res) =>
    customer.emit("chat:send", { bookingId: bid, text: "Alles klar, danke!" }, res),
  );
  check("customer chat:send ack ok", cAck && cAck.ok === true, cAck);
  const drvMsg = await drvRecv;
  check("driver received customer msg", drvMsg.text === "Alles klar, danke!", drvMsg);
  customer.close();

  // 5) Zwischenstopp waehrend der Fahrt via driver:changeDest -> Neuberechnung
  console.log("5) driver:changeDest (zweiter Stopp)");
  const chg = await new Promise((res) =>
    socket.emit(
      "driver:changeDest",
      { bookingId: bid, addStop: { address: "Maschsee Nordufer", lat: 52.358, lng: 9.741 } },
      res,
    ),
  );
  check("changeDest ack ok", chg && chg.ok === true, chg);
  b = (await api(`/api/bookings/${bid}`)).body;
  check("now 2 stops", Array.isArray(b.stops) && b.stops.length === 2, b.stops);
  check("destChangeCount incremented", b.destChangeCount === 1, b.destChangeCount);
  check(
    "priceExact recomputed upward",
    typeof b.priceExact === "number" && b.priceExact > priceExactBefore,
    { before: priceExactBefore, after: b.priceExact },
  );

  // 6) Fahrtfortschritt: arrived -> start -> complete (Capture!)
  console.log("6) arrived -> start -> complete");
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid, action: "arrived" }, res));
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid, action: "start" }, res));
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid, action: "complete" }, res));
  await sleep(800);
  b = (await api(`/api/bookings/${bid}`)).body;
  check("status ABGESCHLOSSEN", b.status === "ABGESCHLOSSEN", b.status);
  check("fare equals priceExact", b.fare === b.priceExact, { fare: b.fare, priceExact: b.priceExact });
  // Barfahrt: wird beim Fahrer bezahlt, kein Kartenvorgang, kein Trinkgeld-Dialog.
  check("cash ride stays open for the driver to collect", b.paymentStatus === "OFFEN", b.paymentStatus);
  // Provision pro Fahrt ist abgeschafft: das Unternehmen behaelt den vollen
  // Fahrpreis, die Plattform verdient ausschliesslich am Monatsabo.
  check("no commission, company keeps the full fare", b.platformFee === 0 && b.platformFeeRate === 0 && b.companyNet === b.fare, {
    rate: b.platformFeeRate,
    fee: b.platformFee,
    net: b.companyNet,
    fare: b.fare,
  });

  socket.close();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLGESCHLAGEN – ${failures} Check(s) rot.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E abgebrochen:", e.message);
  process.exit(1);
});
