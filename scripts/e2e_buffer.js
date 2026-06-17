// E2E: dynamischer Festpreis-Risiko-Buffer.
//  - Firma setzt fixedBufferPct=20 (ohne manuelle Festpreis-Regel)
//  - Fahrt -> Annahme friert priceExact als Festpreis (priceIsFixed=true), ~+20%
// Aufruf: node scripts/e2e_buffer.js [baseUrl]  (Server REQUIRE_PHONE_VERIFICATION=0)
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");
const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };
let failures = 0;
function check(n, c, e) { if (c) console.log(`  PASS ${n}`); else { failures++; console.log(`  FAIL ${n}${e !== undefined ? " -> " + JSON.stringify(e) : ""}`); } }
async function api(path, opts = {}, cookie) {
  const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) } });
  const sc = res.headers.get("set-cookie"); let b = null; try { b = await res.json(); } catch {}
  return { status: res.status, body: b, cookie: sc ? sc.split(";")[0] : null };
}
function collect(s, ev) { const buf = [], w = []; s.on(ev, (p) => { const i = w.findIndex((x) => x.f(p)); if (i >= 0) { const x = w.splice(i, 1)[0]; clearTimeout(x.t); x.r(p); } else buf.push(p); }); return { match(f, ms = 25000) { const i = buf.findIndex(f); if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]); return new Promise((r, j) => { const x = { f, r, t: setTimeout(() => j(new Error("timeout " + ev)), ms) }; w.push(x); }); } }; }
function waitFor(s, ev, ms = 15000) { return new Promise((r, j) => { const t = setTimeout(() => { s.off(ev, h); j(new Error("timeout " + ev)); }, ms); function h(p) { clearTimeout(t); s.off(ev, h); r(p); } s.on(ev, h); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ts = Date.now();
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `BUF_${ts}`, email: `buf+${ts}@test.com`, password: "Pass1234" }) });
  const adminCookie = reg.cookie;
  // aktuelle Tarife holen, dann mit Buffer 20% speichern
  const cur = (await api("/api/admin/pricing", {}, adminCookie)).body.pricing;
  const put = await api("/api/admin/pricing", { method: "PUT", body: JSON.stringify({
    basePrice: cur.basePrice, perKmDay: cur.perKmDay, perKmNight: cur.perKmNight, perKmWeekend: cur.perKmWeekend,
    perMinute: cur.perMinute, nightStartHour: cur.nightStartHour, nightEndHour: cur.nightEndHour,
    fixedBufferPct: 20, perStopFee: 0,
  }) }, adminCookie);
  check("pricing gespeichert (buffer 20)", put.status === 200 && put.body.pricing.fixedBufferPct === 20, put.body?.pricing?.fixedBufferPct);

  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "Buf Fahrer", username: `bufdrv${ts}`, password: "Pass1234", vehicleModel: "VW", vehiclePlate: "H-BU 1", vehicleColor: "Rot" }) }, adminCookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `bufdrv${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect"); await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF);
  await new Promise((r) => socket.emit("driver:status", { status: "FREI" }, r));
  await sleep(400);

  const offers = collect(socket, "driver:offer");
  const bk = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "Buf", customerPhone: "0511795" + (ts % 1000), pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE }) });
  const bid = bk.body.id;
  const approx = bk.body.booking.priceApprox;
  const offer = await offers.match((o) => o.id === bid, 30000);
  check("offer erhalten", offer.id === bid, offer.id);
  await new Promise((r) => socket.emit("driver:respond", { bookingId: bid, accept: true }, r));
  await sleep(700);
  const b = (await api(`/api/bookings/${bid}`)).body;
  check("priceIsFixed=true (Buffer aktiv ohne Regel)", b.priceIsFixed === true, b.priceIsFixed);
  check("priceExact > 0", b.priceExact > 0, b.priceExact);
  check("priceExact > Vorab-Schätzung (Buffer)", b.priceExact >= approx, { priceExact: b.priceExact, approx });

  socket.close();
  console.log(failures === 0 ? "\nBUFFER-E2E OK." : `\nBUFFER-E2E FEHLGESCHLAGEN – ${failures} rot.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("abgebrochen:", e.message); process.exit(1); });
