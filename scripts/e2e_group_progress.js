// E2E (Gruppen-Fortschritt X/N): 3 Fahrzeuge nötig -> der Auftrag füllt sich
// 1/3 -> 2/3 -> 3/3, jeder Slot an einen ANDEREN Fahrer; max. 3 Zusagen.
// Aufruf: node scripts/e2e_group_progress.js [baseUrl]
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
  return { wait(f, ms = 18000) { const x = buf.find(f); if (x) return Promise.resolve(x); return new Promise((res, rej) => { const iv = setInterval(() => { const y = buf.find(f); if (y) { clearInterval(iv); clearTimeout(to); res(y); } }, 100); const to = setTimeout(() => { clearInterval(iv); rej(new Error("timeout " + event)); }, ms); }); } };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function token(phone) {
  const rq = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const rc = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: rq.body.devCode }) });
  return rc.body && rc.body.token;
}
async function mkDriver(ts, idx, cookie) {
  const u = `gp${ts}_${idx}`;
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: `GP${idx}`, username: u, password: "Pass1234", vehiclePlate: `H-GP ${idx}`, vehicleClass: "STANDARD" }) }, cookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: u, password: "Pass1234" }) });
  const s = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(s, "connect"); await waitFor(s, "driver:state");
  const offers = collect(s, "driver:offer");
  s.emit("driver:location", HBF);
  await new Promise((r) => s.emit("driver:status", { status: "FREI" }, r));
  return { socket: s, offers };
}
async function assignedCount(gid) {
  const g = await api(`/api/groups/${gid}`);
  return ((g.body && g.body.group && g.body.group.bookings) || []).filter((b) => b.driverId).length;
}

async function main() {
  const ts = Date.now();
  console.log("1) Firma + 3 STANDARD-Fahrer");
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `GP_${ts}`, email: `gp${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  const ds = [await mkDriver(ts, 1, reg.cookie), await mkDriver(ts, 2, reg.cookie), await mkDriver(ts, 3, reg.cookie)];
  await sleep(1200);

  console.log("2) Gruppe mit 3 Fahrzeugen buchen");
  const phone = "0203" + (ts % 1000000);
  const grp = await api("/api/groups", { method: "POST", body: JSON.stringify({ customerName: "Grp3", customerPhone: phone, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, vehicles: [{ vehicleClass: "STANDARD", count: 3 }], totalPassengers: 10, verificationToken: await token(phone) }) });
  check("group of 3 created", grp.status === 201 && grp.body.group.bookings.length === 3, grp.body && grp.body.group && grp.body.group.bookings.length);
  const gid = grp.body.id;
  const children = grp.body.group.bookings.map((b) => b.id);

  console.log("3) Schrittweise Zusagen -> 1/3, 2/3, 3/3 (verschiedene Fahrer)");
  for (let i = 0; i < 3; i++) {
    await ds[i].offers.wait((o) => o.id === children[i], 20000);
    await new Promise((r) => ds[i].socket.emit("driver:respond", { bookingId: children[i], accept: true }, r));
    // auf Fortschritt warten
    let n = 0;
    for (let k = 0; k < 15 && n < i + 1; k++) { await sleep(500); n = await assignedCount(gid); }
    check(`progress ${i + 1}/3`, n === i + 1, n);
  }

  const g = await api(`/api/groups/${gid}`);
  const bs = g.body.group.bookings;
  const distinct = new Set(bs.map((b) => b.driverId).filter(Boolean));
  check("exactly 3 distinct drivers (max N)", distinct.size === 3, Array.from(distinct));
  check("all 3 vehicles assigned", bs.every((b) => b.driverId), bs.map((b) => b.driverId));

  ds.forEach((d) => d.socket.disconnect());
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
