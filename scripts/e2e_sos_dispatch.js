// E2E (Phase 21 SOS-Notfall-Dispatch): ein eingeloggter Kunde löst SOS mit
// Standort aus -> das System schickt automatisch den nächsten freien Fahrer als
// Notfall-Einsatz (driver:emergency) zum SOS-Standort.
// Aufruf: node scripts/e2e_sos_dispatch.js [baseUrl]
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");

const SOS_LOC = { lat: 52.3801, lng: 9.74 };
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
function once(socket, event) {
  let val = null;
  socket.on(event, (p) => { val = p; });
  return () => val;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function verifyToken(phone) {
  const req = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const con = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: req.body.devCode }) });
  return con.body && con.body.token;
}

async function main() {
  const ts = Date.now();
  console.log("1) Firma + freier Fahrer (nahe SOS-Standort)");
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `SOS_${ts}`, email: `sos${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "SOS Retter", username: `sosdrv${ts}`, password: "Pass1234", vehiclePlate: "H-SOS 1", vehicleClass: "STANDARD" }) }, reg.cookie);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `sosdrv${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  const getEmergency = once(socket, "driver:emergency");
  socket.emit("driver:location", { lat: 52.3805, lng: 9.741 });
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  await sleep(700);

  console.log("2) Kunde registrieren + SOS mit Standort auslösen");
  const phone = "0195" + (ts % 10000000);
  const cust = await api("/api/customer/register", { method: "POST", body: JSON.stringify({ name: "SOS Kunde", email: `soscust${ts}@test.com`, phone, password: "Pass1234", verificationToken: await verifyToken(phone) }) });
  const sos = await api("/api/sos", { method: "POST", body: JSON.stringify({ lat: SOS_LOC.lat, lng: SOS_LOC.lng, message: "Notfall" }) }, cust.cookie);
  check("sos accepted", sos.status === 201, sos.body);
  check("rescue booking created", !!sos.body.rescueBookingId, sos.body);
  check("nearest driver auto-assigned", !!(sos.body.rescueDriver && sos.body.rescueDriver.name), sos.body.rescueDriver);

  console.log("3) Fahrer erhält Notfall-Einsatz");
  await sleep(600);
  const emg = getEmergency();
  check("driver received driver:emergency", !!emg, emg);
  if (emg) {
    check("emergency booking isSos", emg.isSos === true, emg.isSos);
    check("pickup at SOS location", Math.abs(emg.pickupLat - SOS_LOC.lat) < 0.001 && Math.abs(emg.pickupLng - SOS_LOC.lng) < 0.001, { lat: emg.pickupLat, lng: emg.pickupLng });
    check("driver underway", emg.trackingStatus === "FAHRER_UNTERWEGS", emg.trackingStatus);
  }

  // Gegencheck: Rettungsfahrt ist dem Fahrer zugewiesen
  const rb = await api(`/api/bookings/${sos.body.rescueBookingId}`);
  check("rescue booking assigned to a driver", !!(rb.body && (rb.body.booking || rb.body).driverId || (rb.body && rb.body.driverId)), rb.body && (rb.body.driverId || (rb.body.booking && rb.body.booking.driverId)));

  console.log("4) Admin sieht den Notfall im Dashboard und kann ihn erledigen");
  const adminCookie = reg.cookie;
  const list = await api("/api/admin/sos", {}, adminCookie);
  check("admin sos list ok", list.status === 200, list.status);
  const mine = (list.body.alerts || []).find((a) => a.id === sos.body.id);
  check("alert visible to responding company admin", !!mine, (list.body.alerts || []).map((a) => a.id));
  const res = await api("/api/admin/sos", { method: "PATCH", body: JSON.stringify({ id: sos.body.id }) }, adminCookie);
  check("admin can resolve", res.status === 200, res.body);
  const list2 = await api("/api/admin/sos", {}, adminCookie);
  check("alert gone after resolve", !(list2.body.alerts || []).some((a) => a.id === sos.body.id));

  socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
