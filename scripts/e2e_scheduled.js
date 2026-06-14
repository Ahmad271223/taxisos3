// E2E Vorbestellung: eine weit in der Zukunft geplante Fahrt, die ein Fahrer
// RESERVIERT, darf NICHT sofort als aktueller Auftrag erscheinen, sondern erst
// unter "Meine geplanten Fahrten". Aufruf: node scripts/e2e_scheduled.js [baseUrl]
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");

const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };

let failures = 0;
function check(n, c, x) {
  if (c) console.log(`  PASS ${n}`);
  else {
    failures++;
    console.log(`  FAIL ${n}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`);
  }
}
async function api(p, o = {}, c) {
  const r = await fetch(BASE + p, { ...o, headers: { "Content-Type": "application/json", ...(c ? { Cookie: c } : {}), ...(o.headers || {}) } });
  const sc = r.headers.get("set-cookie");
  let b = null;
  try {
    b = await r.json();
  } catch {}
  return { status: r.status, body: b, cookie: sc ? sc.split(";")[0] : null };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emitAck = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));
function waitFor(s, e, ms = 15000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout " + e)), ms);
    s.once(e, (p) => {
      clearTimeout(t);
      res(p);
    });
  });
}

async function main() {
  const ts = Date.now();
  console.log("Setup: Firma + Fahrer");
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `TEST_SCH_${ts}`, email: `sch+${ts}@test.com`, password: "Pass1234" }) });
  const admin = reg.cookie;
  await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "Sch Fahrer", username: `schd${ts}`, password: "Pass1234", vehiclePlate: "H-SC 1" }) }, admin);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `schd${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["polling", "websocket"], forceNew: true });
  await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF);
  await emitAck(socket, "driver:status", { status: "FREI" });
  await sleep(300);

  console.log("Vorbestellung weit in der Zukunft anlegen");
  const phone = "0511852" + (ts % 1000);
  const vq = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const vc = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: vq.body.devCode }) });
  const future = new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString(); // +200 Tage
  const bk = await api("/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      company: reg.body.slug,
      customerName: "Sch Kunde",
      customerPhone: phone,
      pickupAddress: "HBF Hannover",
      pickup: HBF,
      destAddress: "Kröpcke",
      dest: KROEPCKE,
      paymentMethod: "CASH",
      scheduledAt: future,
      verificationToken: vc.body.token,
    }),
  });
  check("scheduled booking created", bk.status === 201, bk.body);
  const bid = bk.body.id;
  check("isScheduled true", bk.body.booking.isScheduled === true, bk.body.booking.isScheduled);

  console.log("Fahrer reserviert die Vorbestellung");
  // driver:state-Waiter VOR dem Reservieren aufsetzen (der reserve-Handler
  // sendet bei Erfolg driver:state).
  const statePromise = waitFor(socket, "driver:state", 15000);
  const res = await emitAck(socket, "driver:reserve", { bookingId: bid });
  check("reserve ok", res && res.ok === true, res);
  const st = await statePromise;

  check("NICHT als aktueller Auftrag (Zukunft)", !st.activeBooking || st.activeBooking.id !== bid, st.activeBooking && st.activeBooking.id);
  check("erscheint unter Meine geplanten Fahrten", (st.myScheduled || []).some((b) => b.id === bid), (st.myScheduled || []).map((b) => b.id));

  socket.close();
  console.log(failures === 0 ? "\nScheduled-E2E OK – Vorbestellung erscheint erst zur geplanten Zeit live." : `\nScheduled-E2E FEHLGESCHLAGEN – ${failures} rot.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Scheduled-E2E abgebrochen:", e.message);
  process.exit(1);
});
