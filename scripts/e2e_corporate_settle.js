// E2E: QR-Firmenmobilität – Settlement.
//  - Buchung mit Firmen-Code -> Hold (Schätzung) auf usedCents, usedRides+1
//  - Fahrtende -> usedCents auf den tatsächlichen Endpreis (fare) korrigiert
//  - Zweite Buchung -> Storno -> Hold + Fahrt wieder freigegeben
// Aufruf: node scripts/e2e_corporate_settle.js [baseUrl]
// Server bitte mit REQUIRE_PHONE_VERIFICATION=0 starten.
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");

const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  PASS ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`); }
}
async function api(path, opts = {}, cookie) {
  const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) } });
  const setCookie = res.headers.get("set-cookie");
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body, cookie: setCookie ? setCookie.split(";")[0] : null };
}
function collect(socket, event) {
  const buf = [], waiters = [];
  socket.on(event, (p) => { const i = waiters.findIndex((w) => w.filter(p)); if (i >= 0) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(p); } else buf.push(p); });
  return { match(filter, timeoutMs = 25000) { const i = buf.findIndex(filter); if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]); return new Promise((resolve, reject) => { const w = { filter, resolve, timer: setTimeout(() => { const j = waiters.indexOf(w); if (j >= 0) waiters.splice(j, 1); reject(new Error(`timeout waiting for ${event}`)); }, timeoutMs) }; waiters.push(w); }); } };
}
function waitFor(socket, event, timeoutMs = 15000) {
  return new Promise((resolve, reject) => { const t = setTimeout(() => { socket.off(event, h); reject(new Error(`timeout ${event}`)); }, timeoutMs); function h(p) { clearTimeout(t); socket.off(event, h); resolve(p); } socket.on(event, h); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function corp(code, cookie) {
  const r = await api("/api/events/corporate", {}, cookie);
  return (r.body.codes || []).find((x) => x.code === code);
}

async function main() {
  const ts = Date.now();
  // 1) Firma + Fahrer
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `CORP_E2E_${ts}`, email: `corp+${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  check("company registered", reg.status === 200 || reg.status === 201, reg.status);
  const adminCookie = reg.cookie;
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "Corp Fahrer", username: `corpdrv${ts}`, password: "Pass1234", vehicleModel: "VW", vehiclePlate: "H-CO 1", vehicleColor: "Schwarz" }) }, adminCookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `corpdrv${ts}`, password: "Pass1234" }) });
  const driverCookie = login.cookie;

  // 2) Fahrer-Socket FREI + GPS am HBF
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: driverCookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF);
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  await sleep(400);

  // 3) Event-Host + Firmen-Code (hohes Budget, kein Pro-Fahrt-Limit)
  const ev = await api("/api/events/register", { method: "POST", body: JSON.stringify({ name: `Firma ${ts}`, email: `host+${ts}@test.com`, password: "Pass1234" }) });
  const evCookie = ev.cookie;
  const cc = await api("/api/events/corporate", { method: "POST", body: JSON.stringify({ label: "Settle", budgetEuro: 1000 }) }, evCookie);
  const code = cc.body.code.code;
  check("corporate code created", !!code, cc.body);

  // 4) Buchung 1 mit Firmen-Code -> Hold
  const offers = collect(socket, "driver:offer");
  const bk1 = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "Gast 1", customerPhone: "0511700" + (ts % 1000), pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, corporateCode: code }) });
  check("booking1 created", bk1.status === 201, bk1.status);
  check("payment FIRMA", bk1.body.booking.paymentMethod === "FIRMA", bk1.body.booking.paymentMethod);
  const bid1 = bk1.body.id;
  const approx1 = bk1.body.booking.priceApprox;
  const holdCents = Math.round(approx1 * 100);
  let c = await corp(code, evCookie);
  check("hold: usedRides=1", c.usedRides === 1, c.usedRides);
  check("hold: usedCents=Schätzung", c.usedCents === holdCents, { usedCents: c.usedCents, holdCents });

  // 5) Fahrt 1 annehmen + abschließen
  const offer1 = await offers.match((o) => o.id === bid1, 30000);
  check("offer1 received", offer1.id === bid1, offer1.id);
  await new Promise((res) => socket.emit("driver:respond", { bookingId: bid1, accept: true }, res));
  await sleep(600);
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid1, action: "arrived" }, res));
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid1, action: "start" }, res));
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid1, action: "complete" }, res));
  await sleep(800);
  const b1 = (await api(`/api/bookings/${bid1}`)).body;
  check("booking1 abgeschlossen", b1.status === "ABGESCHLOSSEN", b1.status);
  const fareCents = Math.round(b1.fare * 100);
  c = await corp(code, evCookie);
  check("settle: usedCents=Endpreis(fare)", c.usedCents === fareCents, { usedCents: c.usedCents, fareCents, fare: b1.fare });
  check("settle: usedRides bleibt 1", c.usedRides === 1, c.usedRides);
  const settled1 = c.usedCents;

  // 6) Buchung 2 -> Storno -> Freigabe
  const bk2 = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "Gast 2", customerPhone: "0511701" + (ts % 1000), pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, corporateCode: code }) });
  const bid2 = bk2.body.id;
  c = await corp(code, evCookie);
  check("nach Buchung2: usedRides=2", c.usedRides === 2, c.usedRides);
  check("nach Buchung2: usedCents gestiegen", c.usedCents > settled1, { usedCents: c.usedCents, settled1 });
  const cancel = await api(`/api/bookings/${bid2}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Test" }) });
  check("cancel ok", cancel.status === 200, cancel.status);
  await sleep(400);
  c = await corp(code, evCookie);
  check("release: usedRides zurück auf 1", c.usedRides === 1, c.usedRides);
  check("release: usedCents zurück auf settled1", c.usedCents === settled1, { usedCents: c.usedCents, settled1 });

  socket.close();
  console.log(failures === 0 ? "\nCORPORATE-SETTLE OK – alle Checks bestanden." : `\nCORPORATE-SETTLE FEHLGESCHLAGEN – ${failures} rot.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("abgebrochen:", e.message); process.exit(1); });
