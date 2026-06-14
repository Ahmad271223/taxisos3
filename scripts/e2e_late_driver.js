// E2E (Bugfix "Kunde steckt fest"): wird zunächst KEIN Fahrer gefunden und
// kommt erst SPÄTER ein freier Fahrer, wird die Fahrt trotzdem zugewiesen und
// der aktualisierte Status ist via GET /api/bookings/[id] abrufbar (= das
// Fallback-Polling der Tracking-Seite würde den Kunden nachziehen).
// Aufruf: node scripts/e2e_late_driver.js [baseUrl]
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
function waitFor(socket, event, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { socket.off(event, h); reject(new Error(`timeout ${event}`)); }, timeoutMs);
    function h(p) { clearTimeout(t); socket.off(event, h); resolve(p); }
    socket.on(event, h);
  });
}
function collect(socket, event) {
  const buf = []; socket.on(event, (p) => buf.push(p));
  return { wait(f, ms = 20000) { const x = buf.find(f); if (x) return Promise.resolve(x); return new Promise((res, rej) => { const iv = setInterval(() => { const y = buf.find(f); if (y) { clearInterval(iv); clearTimeout(to); res(y); } }, 150); const to = setTimeout(() => { clearInterval(iv); rej(new Error("timeout " + event)); }, ms); }); } };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function token(phone) {
  const rq = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const rc = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: rq.body.devCode }) });
  return rc.body && rc.body.token;
}
async function status(bid) { const r = await api(`/api/bookings/${bid}`); return (r.body && (r.body.booking || r.body)) || {}; }

async function main() {
  const ts = Date.now();
  console.log("1) Firma + Fahrer, Fahrer verbunden aber NICHT frei (Pause)");
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `LATE_${ts}`, email: `late${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "Spät Fahrer", username: `late${ts}`, password: "Pass1234", vehiclePlate: "H-LT 1", vehicleClass: "STANDARD" }) }, reg.cookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `late${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  const offers = collect(socket, "driver:offer");
  socket.emit("driver:location", HBF); // Standort da, aber Status bleibt PAUSE

  console.log("2) Buchung -> zunächst kein freier Fahrer (SUCHE)");
  const phone = "0211" + (ts % 1000000);
  const bk = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "Wartet", customerPhone: phone, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, verificationToken: await token(phone) }) });
  check("booking created", bk.status === 201, bk.body);
  const bid = bk.body.id;
  await sleep(1500);
  const s1 = await status(bid);
  check("noch kein Fahrer zugewiesen", !s1.driverId, s1.driverId);

  console.log("3) Fahrer wird JETZT frei -> Fahrt wird ihm zugewiesen");
  await new Promise((r) => socket.emit("driver:status", { status: "FREI" }, r));
  const offer = await offers.wait((o) => o.id === bid, 22000);
  check("Fahrer bekommt das (späte) Angebot", offer.id === bid);
  await new Promise((r) => socket.emit("driver:respond", { bookingId: bid, accept: true }, r));

  console.log("4) Status ist abrufbar (Kunde würde via Polling nachziehen)");
  let s2 = {};
  for (let i = 0; i < 12; i++) { await sleep(700); s2 = await status(bid); if (s2.driverId) break; }
  check("Buchung jetzt einem Fahrer zugewiesen", !!s2.driverId, s2.driverId);
  check("Status FAHRER_UNTERWEGS/ZUGEWIESEN", ["FAHRER_UNTERWEGS", "ZUGEWIESEN"].includes(s2.trackingStatus), s2.trackingStatus);

  socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
