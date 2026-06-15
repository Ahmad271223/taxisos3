// E2E (Phase 15 Krankenfahrten): medizinische Freigabe-Disposition.
// Eine Buchung mit medicalType darf NUR an Fahrer gehen, die fuer Krankenfahrten
// freigegeben sind (Driver.medicalAllowed). Szenario:
//   A) WHEELCHAIR-Fahrer OHNE Freigabe + Krankenfahrt (WHEELCHAIR) -> KEIN Angebot,
//      Auftrag bleibt OFFEN ohne Fahrer ("sicheres Haengen").
//   B) Derselbe Fahrer wird freigegeben (Admin) und reconnectet -> Krankenfahrt
//      wird ihm jetzt angeboten.
//   C) Kontrolle: eine normale (nicht-medizinische) WHEELCHAIR-Buchung haette der
//      nicht-freigegebene Fahrer sehr wohl bekommen -> belegt, dass das Haengen an
//      der Freigabe liegt, nicht an der Klasse.
// Aufruf: node scripts/e2e_medical_dispatch.js [baseUrl]
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

async function book({ vehicleClass, medicalType, phone }) {
  const token = await verifyToken(phone);
  return api("/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      customerName: "MED E2E",
      customerPhone: phone,
      pickupAddress: "HBF Hannover",
      pickup: HBF,
      destAddress: "Kröpcke",
      dest: KROEPCKE,
      vehicleClass,
      medicalType: medicalType ?? null,
      verificationToken: token,
    }),
  });
}

// Fahrer-Socket verbinden, FREI melden, GPS am HBF setzen. Liefert {socket, offers}.
async function connectDriver(driverCookie) {
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: driverCookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  const offers = collect(socket, "driver:offer");
  socket.emit("driver:location", HBF);
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  await sleep(500);
  return { socket, offers };
}

async function main() {
  const ts = Date.now();
  console.log("1) Setup: Firma + WHEELCHAIR-Fahrer OHNE Krankenfahrt-Freigabe");
  const reg = await api("/api/companies/register", {
    method: "POST",
    body: JSON.stringify({ name: `TEST_MEDE2E_${ts}`, email: `mede2e+${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }),
  });
  check("company registered", reg.status === 200 || reg.status === 201, reg.body);
  const adminCookie = reg.cookie;

  const drv = await api(
    "/api/admin/drivers",
    { method: "POST", body: JSON.stringify({ name: "MED Fahrer", username: `mede2e${ts}`, password: "Pass1234", vehiclePlate: "H-MED 1", vehicleClass: "WHEELCHAIR" }) },
    adminCookie,
  );
  check("wheelchair driver created", drv.status === 201 || drv.status === 200, drv.body);
  const driverId = drv.body && drv.body.driver && drv.body.driver.id;
  check("driver class WHEELCHAIR", drv.body && drv.body.driver && drv.body.driver.vehicleClass === "WHEELCHAIR", drv.body && drv.body.driver);
  check("driver NOT medical-approved by default", drv.body && drv.body.driver && drv.body.driver.medicalAllowed === false, drv.body && drv.body.driver);

  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `mede2e${ts}`, password: "Pass1234" }) });
  check("driver login", login.status === 200, login.body);
  const driverCookie = login.cookie;

  console.log("2) Fahrer online (FREI) am HBF");
  let { socket, offers } = await connectDriver(driverCookie);

  console.log("3) Krankenfahrt (DIALYSE, WHEELCHAIR) -> darf NICHT an nicht-freigegebenen Fahrer gehen");
  const medPhone = "0151700" + (ts % 1000);
  const med = await book({ vehicleClass: "WHEELCHAIR", medicalType: "DIALYSE", phone: medPhone });
  check("medical booking created", med.status === 201, med.body);
  const medBid = med.body && med.body.id;
  check("medicalType stored", med.body && med.body.booking && med.body.booking.medicalType === "DIALYSE", med.body && med.body.booking);

  await sleep(6000); // dem Dispatcher Zeit fuer mehrere Phasen geben
  check("no offer to non-approved driver for medical booking", !offers.has((o) => o.id === medBid));

  // Sicheres Haengen: Auftrag bleibt OFFEN, kein Fahrer zugewiesen.
  const after = await api(`/api/bookings/${medBid}`);
  check("medical booking still OFFEN (hanging)", after.body && after.body.status === "OFFEN", after.body && { status: after.body.status, trackingStatus: after.body.trackingStatus });
  check("medical booking has no driver assigned", after.body && !after.body.driverId, after.body && after.body.driverId);

  console.log("4) Kontrolle: normale (nicht-medizinische) WHEELCHAIR-Buchung -> Angebot kommt sehr wohl an");
  const normPhone = "0151710" + (ts % 1000);
  const norm = await book({ vehicleClass: "WHEELCHAIR", phone: normPhone });
  check("normal wheelchair booking created", norm.status === 201, norm.body);
  const normBid = norm.body && norm.body.id;
  let gotNormal = false;
  try {
    const offer = await offers.waitFor((o) => o.id === normBid, 20000);
    gotNormal = offer.id === normBid;
  } catch {}
  check("offer received for normal wheelchair booking (class matches, only medical gate blocks)", gotNormal);
  // Aufraeumen: diese Kontroll-Buchung stornieren, Fahrer wieder frei machen.
  await api(`/api/bookings/${normBid}/cancel`, { method: "POST", body: JSON.stringify({}) }).catch(() => {});

  console.log("5) Admin gibt Fahrer fuer Krankenfahrten frei");
  const patch = await api(`/api/admin/drivers/${driverId}`, { method: "PATCH", body: JSON.stringify({ medicalAllowed: true }) }, adminCookie);
  check("driver patched medicalAllowed=true", patch.status === 200 && patch.body && patch.body.driver && patch.body.driver.medicalAllowed === true, patch.body && patch.body.driver);

  // Die Freigabe greift im Dispatcher erst beim Reconnect (Live-Map wird in
  // onDriverConnect aus der DB neu geladen) – realistischer Schichtbeginn.
  console.log("6) Fahrer reconnectet -> Freigabe wird in die Live-Map uebernommen");
  socket.disconnect();
  await sleep(500);
  ({ socket, offers } = await connectDriver(driverCookie));

  console.log("7) Krankenfahrt erneut -> wird dem jetzt freigegebenen Fahrer angeboten");
  const med2Phone = "0151720" + (ts % 1000);
  const med2 = await book({ vehicleClass: "WHEELCHAIR", medicalType: "DIALYSE", phone: med2Phone });
  check("second medical booking created", med2.status === 201, med2.body);
  const med2Bid = med2.body && med2.body.id;
  let gotMedical = false;
  try {
    const offer = await offers.waitFor((o) => o.id === med2Bid, 20000);
    gotMedical = offer.id === med2Bid;
  } catch {}
  check("offer received for medical booking after approval", gotMedical);

  socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
