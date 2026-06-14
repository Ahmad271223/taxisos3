// E2E (Phase 12 Fahrzeug-Marktplatz): klassenabhängige Disposition.
// Ein STANDARD-Fahrer erhält NUR Angebote für STANDARD-Buchungen, nicht für
// eine Großraum-(VAN-)Buchung. Zusätzlich: VAN-Buchung ist teurer (Klassenfaktor).
// Aufruf: node scripts/e2e_vehicle_class.js [baseUrl]
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");

const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`);
  }
}

async function api(path, opts = {}, cookie) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body, cookie: setCookie ? setCookie.split(";")[0] : null };
}

function waitFor(socket, event, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, h);
      reject(new Error(`timeout ${event}`));
    }, timeoutMs);
    function h(p) {
      clearTimeout(t);
      socket.off(event, h);
      resolve(p);
    }
    socket.on(event, h);
  });
}

function collect(socket, event) {
  const buf = [];
  socket.on(event, (p) => buf.push(p));
  return {
    has: (filter) => buf.some(filter),
    waitFor(filter, timeoutMs = 20000) {
      const found = buf.find(filter);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const iv = setInterval(() => {
          const f = buf.find(filter);
          if (f) {
            clearInterval(iv);
            clearTimeout(to);
            resolve(f);
          }
        }, 150);
        const to = setTimeout(() => {
          clearInterval(iv);
          reject(new Error(`timeout ${event}`));
        }, timeoutMs);
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function verifyToken(phone) {
  const req = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const code = req.body && req.body.devCode;
  if (!code) return null;
  const con = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code }) });
  return con.body && con.body.token;
}

async function book(vehicleClass, phone) {
  const token = await verifyToken(phone);
  return api("/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      customerName: "VC E2E",
      customerPhone: phone,
      pickupAddress: "HBF Hannover",
      pickup: HBF,
      destAddress: "Kröpcke",
      dest: KROEPCKE,
      vehicleClass,
      verificationToken: token,
    }),
  });
}

async function main() {
  const ts = Date.now();
  console.log("1) Setup: Firma + STANDARD-Fahrer");
  const reg = await api("/api/companies/register", {
    method: "POST",
    body: JSON.stringify({ name: `TEST_VCE2E_${ts}`, email: `vce2e+${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }),
  });
  check("company registered", reg.status === 200 || reg.status === 201, reg.body);
  const adminCookie = reg.cookie;

  const drv = await api(
    "/api/admin/drivers",
    { method: "POST", body: JSON.stringify({ name: "VC Fahrer", username: `vce2e${ts}`, password: "Pass1234", vehiclePlate: "H-VC 1", vehicleClass: "STANDARD" }) },
    adminCookie,
  );
  check("standard driver created", drv.status === 201 || drv.status === 200, drv.body);
  check("driver class STANDARD", drv.body && drv.body.driver && drv.body.driver.vehicleClass === "STANDARD", drv.body && drv.body.driver);

  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `vce2e${ts}`, password: "Pass1234" }) });
  check("driver login", login.status === 200, login.body);
  const driverCookie = login.cookie;

  console.log("2) Fahrer-Socket FREI + GPS");
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: driverCookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  const offers = collect(socket, "driver:offer");
  socket.emit("driver:location", HBF);
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  await sleep(500);

  console.log("3) VAN-Buchung -> STANDARD-Fahrer darf KEIN Angebot bekommen");
  const vanPhone = "0151888" + (ts % 1000);
  const van = await book("VAN", vanPhone);
  check("VAN booking created", van.status === 201, van.body);
  const vanBid = van.body && van.body.id;
  check("VAN class stored", van.body && van.body.booking && van.body.booking.vehicleClass === "VAN", van.body && van.body.booking);
  await sleep(4000); // dem Dispatcher Zeit geben
  check("no offer to STANDARD driver for VAN booking", !offers.has((o) => o.id === vanBid));

  console.log("4) STANDARD-Buchung -> Angebot kommt an");
  const stdPhone = "0151999" + (ts % 1000);
  const std = await book("STANDARD", stdPhone);
  check("STANDARD booking created", std.status === 201, std.body);
  const stdBid = std.body && std.body.id;
  let gotOffer = false;
  try {
    const offer = await offers.waitFor((o) => o.id === stdBid, 20000);
    gotOffer = offer.id === stdBid;
  } catch {}
  check("offer received for STANDARD booking", gotOffer);

  console.log("5) Preis: VAN teurer als STANDARD (Klassenfaktor)");
  check(
    "VAN priceApprox > STANDARD priceApprox",
    van.body.booking.priceApprox > std.body.booking.priceApprox,
    { van: van.body.booking.priceApprox, std: std.body.booking.priceApprox },
  );

  socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
