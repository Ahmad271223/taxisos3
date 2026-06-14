// E2E (Phase 18 Punkte): ein eingeloggter Kunde bucht, der Fahrer schließt die
// Fahrt ab -> der Kunde erhält Bonuspunkte (1 je vollem Euro Fahrpreis).
// Aufruf: node scripts/e2e_points.js [baseUrl]
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");

const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`);
  }
}
async function api(path, opts = {}, cookie) {
  const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) } });
  const setCookie = res.headers.get("set-cookie");
  let body = null;
  try {
    body = await res.json();
  } catch {}
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
  return {
    waitFor(filter, timeoutMs = 25000) {
      const f = buf.find(filter);
      if (f) return Promise.resolve(f);
      return new Promise((resolve, reject) => {
        const iv = setInterval(() => { const x = buf.find(filter); if (x) { clearInterval(iv); clearTimeout(to); resolve(x); } }, 120);
        const to = setTimeout(() => { clearInterval(iv); reject(new Error(`timeout ${event}`)); }, timeoutMs);
      });
    },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function verifyToken(phone) {
  const req = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const code = req.body && req.body.devCode;
  const con = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code }) });
  return con.body && con.body.token;
}

async function main() {
  const ts = Date.now();
  console.log("1) Kunde registrieren");
  const phone = "0194" + (ts % 10000000);
  const cust = await api("/api/customer/register", {
    method: "POST",
    body: JSON.stringify({ name: "Punkte Kunde", email: `pts+${ts}@test.com`, phone, password: "Pass1234", verificationToken: await verifyToken(phone) }),
  });
  check("customer registered", cust.status === 201 || cust.status === 200, cust.body);
  const custCookie = cust.cookie;

  console.log("2) Firma + Fahrer + Fahrer-Socket FREI");
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `PTS_${ts}`, email: `pts${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "Pts Fahrer", username: `ptsdrv${ts}`, password: "Pass1234", vehiclePlate: "H-PT 1", vehicleClass: "STANDARD" }) }, reg.cookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `ptsdrv${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  const offers = collect(socket, "driver:offer");
  socket.emit("driver:location", HBF);
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  await sleep(600);

  console.log("3) Kunde bucht (Kontonummer überspringt SMS)");
  const bk = await api("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ customerName: "Punkte Kunde", customerPhone: phone, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE }),
  }, custCookie);
  check("booking created + tied to account", bk.status === 201, bk.body);
  const bid = bk.body.id;

  console.log("4) Fahrer nimmt an + schließt ab");
  await offers.waitFor((o) => o.id === bid, 25000);
  await new Promise((res) => socket.emit("driver:respond", { bookingId: bid, accept: true }, res));
  await sleep(400);
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid, action: "arrived" }, res));
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid, action: "start" }, res));
  await new Promise((res) => socket.emit("driver:trip", { bookingId: bid, action: "complete" }, res));
  await sleep(800);

  console.log("5) Kunde hat Bonuspunkte erhalten");
  const prof = await api("/api/customer/profile", {}, custCookie);
  const points = prof.body && prof.body.profile && prof.body.profile.points;
  check("points awarded (> 0)", points > 0, points);

  socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
