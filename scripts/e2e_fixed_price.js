// E2E: Festpreis-Engine.
//  - Admin legt Festpreis-Regel an (HBF-Zone -> Kröpcke-Zone = 45 €)
//  - /api/quote zeigt den Festpreis in der Spanne
//  - Buchung der Strecke -> Fahrer nimmt an -> priceExact wird auf 45 € gefroren
//  - Fahrtende -> fare == 45 €; Route außerhalb der Zonen -> Meter-Tarif
// Aufruf: node scripts/e2e_fixed_price.js [baseUrl]   (Server mit REQUIRE_PHONE_VERIFICATION=0)
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");

const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };
const FAR = { lat: 52.52, lng: 9.95 };

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
  return { match(filter, t = 25000) { const i = buf.findIndex(filter); if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]); return new Promise((resolve, reject) => { const w = { filter, resolve, timer: setTimeout(() => reject(new Error(`timeout ${event}`)), t) }; waiters.push(w); }); } };
}
function waitFor(socket, event, t = 15000) {
  return new Promise((resolve, reject) => { const tm = setTimeout(() => { socket.off(event, h); reject(new Error(`timeout ${event}`)); }, t); function h(p) { clearTimeout(tm); socket.off(event, h); resolve(p); } socket.on(event, h); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ts = Date.now();
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `FP_E2E_${ts}`, email: `fp+${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  check("company registered", reg.status === 200 || reg.status === 201, reg.status);
  const adminCookie = reg.cookie;
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "FP Fahrer", username: `fpdrv${ts}`, password: "Pass1234", vehicleModel: "VW", vehiclePlate: "H-FP 1", vehicleColor: "Blau" }) }, adminCookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `fpdrv${ts}`, password: "Pass1234" }) });
  const driverCookie = login.cookie;

  // Festpreis-Regel: HBF-Zone -> Kröpcke-Zone = 45 €
  console.log("1) Admin legt Festpreis an");
  const rule = await api("/api/admin/fixed-prices", { method: "POST", body: JSON.stringify({ name: "HBF → Kröpcke", fromLat: HBF.lat, fromLng: HBF.lng, fromRadius: 1500, toLat: KROEPCKE.lat, toLng: KROEPCKE.lng, toRadius: 1500, price: 45, bidirectional: true }) }, adminCookie);
  check("fixed rule created (201)", rule.status === 201, rule.status);
  const ruleId = rule.body?.rule?.id;

  // Quote: Festpreis in der Spanne
  console.log("2) Quote zeigt Festpreis");
  const q = await api("/api/quote", { method: "POST", body: JSON.stringify({ from: HBF, to: KROEPCKE }) });
  check("quote fixedPrice = 45", q.body?.fixedPrice === 45, q.body?.fixedPrice);
  check("quote priceMax >= 45", q.body?.priceMax >= 45, q.body?.priceMax);
  const qFar = await api("/api/quote", { method: "POST", body: JSON.stringify({ from: HBF, to: FAR }) });
  check("quote außerhalb: kein Festpreis", qFar.body?.fixedPrice == null, qFar.body?.fixedPrice);

  // Fahrer online am HBF
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: driverCookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF);
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  await sleep(400);

  // Buchung HBF -> Kröpcke
  console.log("3) Buchung + Annahme friert 45 €");
  const offers = collect(socket, "driver:offer");
  const bk = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "FP Gast", customerPhone: "0511790" + (ts % 1000), pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE }) });
  check("booking created", bk.status === 201, bk.status);
  check("hold priceMax >= 45", bk.body.booking.priceMax >= 45, bk.body.booking.priceMax);
  const bid = bk.body.id;
  const offer = await offers.match((o) => o.id === bid, 30000);
  check("offer received", offer.id === bid, offer.id);
  await new Promise((res) => socket.emit("driver:respond", { bookingId: bid, accept: true }, res));
  await sleep(700);
  let b = (await api(`/api/bookings/${bid}`)).body;
  check("priceExact == 45 (gefroren)", b.priceExact === 45, b.priceExact);
  check("priceIsFixed == true", b.priceIsFixed === true, b.priceIsFixed);

  // Fahrt abschließen
  console.log("4) Fahrtende");
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid, action: "arrived" }, res));
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid, action: "start" }, res));
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid, action: "complete" }, res));
  await sleep(800);
  b = (await api(`/api/bookings/${bid}`)).body;
  check("fare == 45", b.fare === 45, b.fare);
  check("priceIsFixed bleibt true", b.priceIsFixed === true, b.priceIsFixed);

  // CRUD: Pausieren + Löschen
  console.log("5) Verwaltung (pausieren/löschen)");
  const tg = await api(`/api/admin/fixed-prices/${ruleId}`, { method: "PATCH", body: JSON.stringify({ active: false }) }, adminCookie);
  check("toggle 200", tg.status === 200, tg.status);
  const qPaused = await api("/api/quote", { method: "POST", body: JSON.stringify({ from: HBF, to: KROEPCKE }) });
  check("pausiert: kein Festpreis mehr", qPaused.body?.fixedPrice == null, qPaused.body?.fixedPrice);
  const del = await api(`/api/admin/fixed-prices/${ruleId}`, { method: "DELETE" }, adminCookie);
  check("delete 200", del.status === 200, del.status);
  const sec = await api(`/api/admin/fixed-prices/${ruleId}`, { method: "DELETE" }); // ohne Cookie
  check("ohne Auth 401", sec.status === 401, sec.status);

  socket.close();
  console.log(failures === 0 ? "\nFIXED-PRICE OK – alle Checks bestanden." : `\nFIXED-PRICE FEHLGESCHLAGEN – ${failures} rot.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("abgebrochen:", e.message); process.exit(1); });
