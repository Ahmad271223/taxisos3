// E2E: No-Show. Firma setzt noShowFee=15. Fahrer fährt zur Abholung, markiert
// nach "Angekommen" -> Gast nicht erschienen. Buchung wird storniert mit Gebühr.
// Aufruf: node scripts/e2e_noshow.js [baseUrl]  (Server REQUIRE_PHONE_VERIFICATION=0)
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
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `NS_${ts}`, email: `ns+${ts}@test.com`, password: "Pass1234" }) });
  const adminCookie = reg.cookie;
  const cur = (await api("/api/admin/pricing", {}, adminCookie)).body.pricing;
  await api("/api/admin/pricing", { method: "PUT", body: JSON.stringify({ basePrice: cur.basePrice, perKmDay: cur.perKmDay, perKmNight: cur.perKmNight, perKmWeekend: cur.perKmWeekend, perMinute: cur.perMinute, noShowFee: 15 }) }, adminCookie);
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "NS Fahrer", username: `nsdrv${ts}`, password: "Pass1234", vehicleModel: "VW", vehiclePlate: "H-NS 1", vehicleColor: "Grau" }) }, adminCookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `nsdrv${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect"); await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF);
  await new Promise((r) => socket.emit("driver:status", { status: "FREI" }, r));
  await sleep(400);
  const offers = collect(socket, "driver:offer");
  const bk = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "NS Gast", customerPhone: "0511796" + (ts % 1000), pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE }) });
  const bid = bk.body.id;
  const offer = await offers.match((o) => o.id === bid, 30000);
  check("offer erhalten", offer.id === bid, offer.id);
  await new Promise((r) => socket.emit("driver:respond", { bookingId: bid, accept: true }, r));
  await sleep(600);
  // Wichtig: erst "angekommen", dann "noshow"
  await new Promise((r) => socket.emit("driver:trip", { bookingId: bid, action: "arrived" }, r));
  await sleep(400);
  await new Promise((r) => socket.emit("driver:trip", { bookingId: bid, action: "noshow" }, r));
  await sleep(700);
  const b = (await api(`/api/bookings/${bid}`)).body;
  check("Status STORNIERT", b.status === "STORNIERT", b.status);
  check("cancelReason NO_SHOW", b.cancelReason === "NO_SHOW", b.cancelReason);
  check("noShowFee = 15", b.noShowFee === 15, b.noShowFee);
  check("fare = 15 (Gebühr abgerechnet)", b.fare === 15, b.fare);
  // Geschaeftsmodell: KEINE Provision pro Fahrt (Einnahmen nur ueber das Abo).
  check("Keine Provision einbehalten (0 %)", b.platformFee === 0 && b.companyNet === b.fare, { platformFee: b.platformFee, companyNet: b.companyNet, fare: b.fare });

  // Negativ: noshow OHNE vorheriges "arrived" wird abgelehnt
  const bk2 = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "NS2", customerPhone: "0511797" + (ts % 1000), pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE }) });
  const bid2 = bk2.body.id;
  const offer2 = await offers.match((o) => o.id === bid2, 30000);
  void offer2;
  await new Promise((r) => socket.emit("driver:respond", { bookingId: bid2, accept: true }, r));
  await sleep(500);
  await new Promise((r) => socket.emit("driver:trip", { bookingId: bid2, action: "noshow" }, r)); // ohne arrived
  await sleep(500);
  const b2 = (await api(`/api/bookings/${bid2}`)).body;
  check("ohne Ankunft: kein No-Show (nicht storniert)", b2.status !== "STORNIERT", b2.status);

  socket.close();
  console.log(failures === 0 ? "\nNO-SHOW-E2E OK." : `\nNO-SHOW-E2E FEHLGESCHLAGEN – ${failures} rot.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("abgebrochen:", e.message); process.exit(1); });
