// E2E (Phase 23 Gezielte Bestellung): wählt der Kunde von der Live-Karte EIN
// bestimmtes Taxi (requestedDriverId), bekommt NUR dieser Fahrer die Anfrage –
// ein zweiter Fahrer derselben Klasse NICHT. Zusätzlich: klassenspezifisch
// (Kindersitz) bekommt nur ein Kindersitz-Taxi ein Angebot.
// Aufruf: node scripts/e2e_targeted_order.js [baseUrl]
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
  return { has: (f) => buf.some(f), wait(f, ms = 18000) { const x = buf.find(f); if (x) return Promise.resolve(x); return new Promise((res, rej) => { const iv = setInterval(() => { const y = buf.find(f); if (y) { clearInterval(iv); clearTimeout(to); res(y); } }, 100); const to = setTimeout(() => { clearInterval(iv); rej(new Error("timeout")); }, ms); }); } };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function token(phone) {
  const rq = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const rc = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: rq.body.devCode }) });
  return rc.body && rc.body.token;
}
async function driver(ts, idx, cookie, vehicleClass, loc) {
  const u = `tdrv${ts}_${idx}`;
  const d = await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: `T${idx}`, username: u, password: "Pass1234", vehiclePlate: `H-T ${idx}`, vehicleClass }) }, cookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: u, password: "Pass1234" }) });
  const s = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(s, "connect"); await waitFor(s, "driver:state");
  const offers = collect(s, "driver:offer");
  s.emit("driver:location", loc);
  await new Promise((r) => s.emit("driver:status", { status: "FREI" }, r));
  return { id: d.body.driver.id, socket: s, offers };
}

async function main() {
  const ts = Date.now();
  console.log("1) Firma + 2 STANDARD-Fahrer (für gezielte Bestellung)");
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `TGT_${ts}`, email: `tgt${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  const a = await driver(ts, 1, reg.cookie, "STANDARD", HBF);
  const b = await driver(ts, 2, reg.cookie, "STANDARD", { lat: 52.376, lng: 9.733 });
  await sleep(900);

  console.log("2) Gezielt Fahrer A bestellen -> nur A bekommt das Angebot");
  const p1 = "0201" + (ts % 1000000);
  const bk = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "Ziel", customerPhone: p1, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, vehicleClass: "STANDARD", requestedDriverId: a.id, verificationToken: await token(p1) }) });
  check("targeted booking created", bk.status === 201, bk.body);
  const bid = bk.body.id;
  let aGot = false; try { await a.offers.wait((o) => o.id === bid, 8000); aGot = true; } catch {}
  check("chosen driver A got the offer", aGot);
  await sleep(1500);
  check("other driver B did NOT get the targeted offer", !b.offers.has((o) => o.id === bid));

  console.log("3) Klassenspezifisch: Kindersitz-Buchung nur an Kindersitz-Taxi");
  const cs = await driver(ts, 3, reg.cookie, "CHILD_SEAT", HBF);
  await sleep(900);
  const p2 = "0202" + (ts % 1000000);
  const bk2 = await api("/api/bookings", { method: "POST", body: JSON.stringify({ customerName: "KS", customerPhone: p2, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, vehicleClass: "CHILD_SEAT", verificationToken: await token(p2) }) });
  check("child-seat booking created", bk2.status === 201, bk2.body);
  const bid2 = bk2.body.id;
  let csGot = false; try { await cs.offers.wait((o) => o.id === bid2, 8000); csGot = true; } catch {}
  check("child-seat taxi got the offer", csGot);
  check("standard driver A did NOT get child-seat offer", !a.offers.has((o) => o.id === bid2));
  check("standard driver B did NOT get child-seat offer", !b.offers.has((o) => o.id === bid2));

  a.socket.disconnect(); b.socket.disconnect(); cs.socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
