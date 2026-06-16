// E2E (Hotel Smart Fleet Routing): ein Hotel mit Flotten-Whitelist bucht eine
// Fahrt -> NUR der Fahrer der bevorzugten Firma erhält in den ersten Phasen das
// Angebot, der Fahrer der nicht-bevorzugten Firma NICHT.
// Aufruf: node scripts/e2e_hotel_whitelist.js [baseUrl]
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
  let body = null;
  try { body = await res.json(); } catch {}
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
  const buf = [];
  socket.on(event, (p) => buf.push(p));
  return { has: (f) => buf.some(f) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeCompanyDriver(tag) {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `WL_${tag}_${ts}`, email: `wl_${tag}_${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  const adminCookie = reg.cookie;
  const username = `wl${tag}${ts}`;
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: `Fahrer ${tag}`, username, password: "Pass1234", vehiclePlate: `H-${tag} 1`, vehicleClass: "STANDARD" }) }, adminCookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  const offers = collect(socket, "driver:offer");
  socket.emit("driver:location", HBF);
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  return { name: `WL_${tag}_${ts}`, adminCookie, socket, offers };
}

async function main() {
  console.log("1) Zwei Firmen + je ein FREI-Fahrer am HBF");
  const A = await makeCompanyDriver("A");
  const B = await makeCompanyDriver("B");
  check("Fahrer A online", true);
  check("Fahrer B online", true);
  await sleep(500);

  console.log("2) Hotel registrieren + Whitelist = Firma A");
  const ts = Date.now();
  const hreg = await api("/api/hotels/register", { method: "POST", body: JSON.stringify({ name: `WL Hotel ${ts}`, email: `wlhotel${ts}@test.com`, password: "Pass1234" }) });
  const hotelCookie = hreg.cookie;
  check("Hotel registriert", hreg.status === 201, hreg.body);
  const comps = await api("/api/hotels/companies", {}, hotelCookie);
  const compA = (comps.body.companies || []).find((c) => c.name === A.name);
  check("Firma A in Liste gefunden", !!compA, comps.body && comps.body.companies && comps.body.companies.length);
  const setRes = await api("/api/hotels/settings", { method: "PATCH", body: JSON.stringify({ preferredCompanyIds: [compA.id] }) }, hotelCookie);
  check("Whitelist gespeichert (Firma A)", setRes.status === 200 && (setRes.body.preferredCompanyIds || []).includes(compA.id), setRes.body);

  console.log("3) Hotel bucht Gast-Fahrt -> nur Firma A darf das Angebot bekommen");
  const ride = await api("/api/hotels/rides", { method: "POST", body: JSON.stringify({ guestName: "Gast", pickup: { address: "HBF", ...HBF }, dest: { address: "Kröpcke", ...KROEPCKE }, vehicleClass: "STANDARD" }) }, hotelCookie);
  check("Hotel-Fahrt erstellt", ride.status === 201, ride.body);
  const bid = ride.body && ride.body.id;
  await sleep(4000); // innerhalb Phase 0

  check("Fahrer A (Whitelist) hat Angebot erhalten", A.offers.has((o) => o.id === bid));
  check("Fahrer B (nicht Whitelist) hat KEIN Angebot erhalten", !B.offers.has((o) => o.id === bid));

  A.socket.disconnect();
  B.socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – Whitelist bevorzugt die Flotte korrekt." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
