// E2E: Storno-Regeln. Firma setzt cancelFee=10. Storno NACH Fahrer-Zuweisung ->
// Gebühr; Storno VOR Zuweisung (noch in Suche) -> kostenlos.
// Aufruf: node scripts/e2e_cancelfee.js [baseUrl]  (Server REQUIRE_PHONE_VERIFICATION=0)
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");
const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };
let failures = 0;
function check(n, c, e) { if (c) console.log(`  PASS ${n}`); else { failures++; console.log(`  FAIL ${n}${e !== undefined ? " -> " + JSON.stringify(e) : ""}`); } }
async function api(p, o = {}, ck) { const res = await fetch(BASE + p, { ...o, headers: { "Content-Type": "application/json", ...(ck ? { Cookie: ck } : {}), ...(o.headers || {}) } }); const sc = res.headers.get("set-cookie"); let b = null; try { b = await res.json(); } catch {} return { status: res.status, body: b, cookie: sc ? sc.split(";")[0] : null }; }
function collect(s, ev) { const buf = [], w = []; s.on(ev, (p) => { const i = w.findIndex((x) => x.f(p)); if (i >= 0) { const x = w.splice(i, 1)[0]; clearTimeout(x.t); x.r(p); } else buf.push(p); }); return { match(f, ms = 25000) { const i = buf.findIndex(f); if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]); return new Promise((r, j) => { const x = { f, r, t: setTimeout(() => j(new Error("timeout " + ev)), ms) }; w.push(x); }); } }; }
function waitFor(s, ev, ms = 15000) { return new Promise((r, j) => { const t = setTimeout(() => { s.off(ev, h); j(new Error("timeout " + ev)); }, ms); function h(p) { clearTimeout(t); s.off(ev, h); r(p); } s.on(ev, h); }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ts = Date.now();
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `CF_${ts}`, email: `cf+${ts}@test.com`, password: "Pass1234" }) });
  const adminCookie = reg.cookie;
  const cur = (await api("/api/admin/pricing", {}, adminCookie)).body.pricing;
  await api("/api/admin/pricing", { method: "PUT", body: JSON.stringify({ basePrice: cur.basePrice, perKmDay: cur.perKmDay, perKmNight: cur.perKmNight, perKmWeekend: cur.perKmWeekend, perMinute: cur.perMinute, cancelFee: 10, freeCancelMinutes: 0 }) }, adminCookie);
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "CF Fahrer", username: `cfdrv${ts}`, password: "Pass1234", vehicleModel: "VW", vehiclePlate: "H-CF 1", vehicleColor: "Grün" }) }, adminCookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `cfdrv${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect"); await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF);
  await new Promise((r) => socket.emit("driver:status", { status: "FREI" }, r));
  await sleep(400);

  // 1) Storno NACH Zuweisung -> Gebühr
  const offers = collect(socket, "driver:offer");
  const bk = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "CF", customerPhone: "0511798" + (ts % 1000), pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE }) });
  const bid = bk.body.id;
  const offer = await offers.match((o) => o.id === bid, 30000); void offer;
  await new Promise((r) => socket.emit("driver:respond", { bookingId: bid, accept: true }, r));
  await sleep(600);
  const cancel = await api(`/api/bookings/${bid}/cancel`, { method: "POST", body: JSON.stringify({ reason: "Test" }) });
  check("Storno ok", cancel.status === 200, cancel.status);
  await sleep(300);
  const b = (await api(`/api/bookings/${bid}`)).body;
  check("nach Zuweisung: STORNIERT", b.status === "STORNIERT", b.status);
  check("cancelReason LATE_CANCEL", b.cancelReason === "LATE_CANCEL", b.cancelReason);
  check("Storno-Gebühr fare=10", b.fare === 10, b.fare);
  check("Provision berechnet", b.platformFee > 0, b.platformFee);

  // Fahrer wieder frei machen
  await new Promise((r) => socket.emit("driver:status", { status: "PAUSE" }, r));
  await sleep(300);

  // 2) Storno VOR Zuweisung (noch in Suche, companyId null) -> kostenlos
  const bk2 = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "CF2", customerPhone: "0511799" + (ts % 1000), pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE }) });
  const bid2 = bk2.body.id;
  await sleep(300);
  await api(`/api/bookings/${bid2}/cancel`, { method: "POST", body: JSON.stringify({ reason: "zu früh" }) });
  await sleep(300);
  const b2 = (await api(`/api/bookings/${bid2}`)).body;
  check("vor Zuweisung: STORNIERT", b2.status === "STORNIERT", b2.status);
  check("vor Zuweisung: keine Gebühr (fare null)", b2.fare == null, b2.fare);
  check("vor Zuweisung: kein LATE_CANCEL", b2.cancelReason !== "LATE_CANCEL", b2.cancelReason);

  socket.close();
  console.log(failures === 0 ? "\nCANCELFEE-E2E OK." : `\nCANCELFEE-E2E FEHLGESCHLAGEN – ${failures} rot.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("abgebrochen:", e.message); process.exit(1); });
