// E2E (Fahrersuche endet nach SEARCH_MAX_MS): Server mit kurzem SEARCH_MAX_MS
// starten (z. B. 6000). Buchung ohne Fahrer -> nach Ablauf KEIN_FAHRER, und ein
// danach frei werdender Fahrer bekommt die Fahrt NICHT mehr (Suche beendet).
// Aufruf: node scripts/e2e_search_timeout.js [baseUrl]   (Server mit SEARCH_MAX_MS=6000)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function token(phone) {
  const rq = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const rc = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: rq.body.devCode }) });
  return rc.body && rc.body.token;
}
async function status(bid) { const r = await api(`/api/bookings/${bid}`); return (r.body && (r.body.booking || r.body)) || {}; }

async function main() {
  const ts = Date.now();
  console.log("1) Firma + Fahrer (bleibt zunächst offline/pause)");
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `TO_${ts}`, email: `to${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "TO Fahrer", username: `to${ts}`, password: "Pass1234", vehiclePlate: "H-TO 1", vehicleClass: "STANDARD" }) }, reg.cookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `to${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF); // PAUSE -> kein Kandidat

  console.log("2) Buchung ohne Fahrer");
  const phone = "0212" + (ts % 1000000);
  const bk = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "Timeout", customerPhone: phone, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, verificationToken: await token(phone) }) });
  check("booking created", bk.status === 201, bk.body);
  const bid = bk.body.id;

  console.log("3) Auf Suchende warten (SEARCH_MAX_MS kurz, ~ bis 40 s)");
  let st = {};
  for (let i = 0; i < 45; i++) { await sleep(2000); st = await status(bid); if (st.trackingStatus === "KEIN_FAHRER") break; }
  check("Suche endet mit KEIN_FAHRER", st.trackingStatus === "KEIN_FAHRER", st.trackingStatus);

  console.log("4) Fahrer wird JETZT frei -> bekommt die abgelaufene Fahrt NICHT mehr");
  await new Promise((r) => socket.emit("driver:status", { status: "FREI" }, r));
  await sleep(25000); // > Sweep-Intervall (20 s)
  const st2 = await status(bid);
  check("Fahrt bleibt KEIN_FAHRER (Suche beendet)", st2.trackingStatus === "KEIN_FAHRER", st2.trackingStatus);
  check("kein Fahrer zugewiesen", !st2.driverId, st2.driverId);

  socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
