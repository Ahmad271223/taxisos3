// E2E (Phase 16 Live-Karte): ein eingeloggter FREI-Fahrer erscheint unter
// /api/taxis/live mit Fahrzeug-/Fahrerprofil (Klasse, Sitze, Gepäck).
// Aufruf: node scripts/e2e_live_taxis.js [baseUrl]
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");

const HBF = { lat: 52.3759, lng: 9.732 };
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`);
  }
}
async function api(path, opts = {}, cookie) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body, cookie: setCookie ? setCookie.split(";")[0] : null };
}
function waitFor(socket, event, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, h);
      reject(new Error(`timeout ${event}`));
    }, timeoutMs);
    function h(p) {
      clearTimeout(t);
      socket.off(event, h);
      resolve(p);
    }
    socket.on(event, h);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ts = Date.now();
  console.log("1) Setup: Firma + VAN-Fahrer");
  const reg = await api("/api/companies/register", {
    method: "POST",
    body: JSON.stringify({ name: `TEST_LIVE_${ts}`, email: `live+${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }),
  });
  check("company registered", reg.status === 200 || reg.status === 201, reg.body);
  const drv = await api(
    "/api/admin/drivers",
    { method: "POST", body: JSON.stringify({ name: "Live Fahrer", username: `live${ts}`, password: "Pass1234", vehicleModel: "VW Caddy", vehicleColor: "Schwarz", vehiclePlate: "H-LV 1", vehicleSeats: 7, vehicleClass: "VAN" }) },
    reg.cookie,
  );
  check("driver created", drv.status === 201 || drv.status === 200, drv.body);
  const did = drv.body.driver.id;

  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `live${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF);
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  await sleep(800);

  console.log("2) /api/taxis/live enthält den Fahrer mit Profil");
  const live = await api("/api/taxis/live");
  check("endpoint ok", live.status === 200, live.status);
  const mine = (live.body.taxis || []).find((t) => t.id === did);
  check("driver visible on live map", !!mine, (live.body.taxis || []).map((t) => t.id));
  if (mine) {
    check("class VAN", mine.vehicleClass === "VAN", mine.vehicleClass);
    check("status FREI", mine.status === "FREI", mine.status);
    check("seats present", mine.vehicleSeats === 7, mine.vehicleSeats);
    check("luggage present", mine.luggage > 0, mine.luggage);
    check("car details", mine.vehiclePlate === "H-LV 1" && !!mine.vehicleModel, mine);
  }
  check("available count >= 1", (live.body.available || 0) >= 1, live.body.available);

  console.log("3) Nach PAUSE verschwindet er aus der Liste");
  await new Promise((res) => socket.emit("driver:status", { status: "PAUSE" }, res));
  await sleep(800);
  const live2 = await api("/api/taxis/live");
  check("driver gone when on PAUSE", !(live2.body.taxis || []).some((t) => t.id === did));

  socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
