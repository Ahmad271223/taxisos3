// E2E mit ZWEI echten Fahrer-Sockets (Phase 3j-Backlog + Phase-1 b Verifikation):
//  Teil 1 – Competitive Dispatch: beide Fahrer erhalten dasselbe Angebot,
//           der erste Annehmende gewinnt, der andere bekommt offerCancel.
//  Teil 2 – ONLINE_RESERVED_NEXT_TRIP: der besetzte, ziel-nahe Fahrer nimmt eine
//           Folgefahrt als RESERVIERT an; nach complete der aktuellen Fahrt wird
//           die reservierte automatisch zu FAHRER_UNTERWEGS promotet.
// Aufruf: node scripts/e2e_parallel_drivers.js [baseUrl]
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

function waitFor(socket, event, timeoutMs = 25000, filter = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      if (!filter(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emitAck = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));

// Puffert Events ab Verbindungsbeginn -> robust gegen fremde Angebote aus der Test-DB.
function collect(socket, event) {
  const buf = [];
  const waiters = [];
  socket.on(event, (p) => {
    const i = waiters.findIndex((w) => w.filter(p));
    if (i >= 0) {
      const w = waiters.splice(i, 1)[0];
      clearTimeout(w.timer);
      w.resolve(p);
    } else buf.push(p);
  });
  return {
    match(filter, timeoutMs = 25000) {
      const i = buf.findIndex(filter);
      if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = {
          filter,
          resolve,
          timer: setTimeout(() => {
            const j = waiters.indexOf(w);
            if (j >= 0) waiters.splice(j, 1);
            reject(new Error(`timeout waiting for ${event}`));
          }, timeoutMs),
        };
        waiters.push(w);
      });
    },
  };
}

async function verifiedToken(phone) {
  const rq = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const code = rq.body && rq.body.devCode;
  if (!code) return null;
  const rc = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code }) });
  return rc.body && rc.body.token;
}

async function makeDriver(adminCookie, ts, suffix, vehicle) {
  const username = `e2e${suffix}${ts}`;
  await api(
    "/api/admin/drivers",
    { method: "POST", body: JSON.stringify({ name: `Fahrer ${suffix}`, username, password: "Pass1234", vehiclePlate: vehicle }) },
    adminCookie,
  );
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password: "Pass1234" }) });
  return login.cookie;
}

function connectDriver(cookie) {
  // forceNew: jeder Fahrer braucht eine EIGENE Verbindung – sonst multiplext
  // socket.io-client beide auf einen gemeinsamen (einmal authentifizierten) Manager.
  return io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: cookie }, transports: ["polling", "websocket"], forceNew: true });
}

async function bookNear(point, destPoint, phoneSuffix, ts) {
  const phone = "05119" + phoneSuffix + (ts % 100);
  const token = await verifiedToken(phone);
  const r = await api("/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      customerName: `Kunde ${phoneSuffix}`,
      customerPhone: phone,
      pickupAddress: "Pickup",
      pickup: point,
      destAddress: "Ziel",
      dest: destPoint,
      paymentMethod: "CASH",
      verificationToken: token,
    }),
  });
  return r;
}

async function main() {
  const ts = Date.now();
  console.log("Setup: Firma + 2 Fahrer");
  const reg = await api("/api/companies/register", {
    method: "POST",
    body: JSON.stringify({ name: `TEST_PAR_${ts}`, email: `par+${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }),
  });
  check("company registered", reg.status === 200 || reg.status === 201, reg.body);
  const admin = reg.cookie;
  const cookieA = await makeDriver(admin, ts, "A", "H-AA 1");
  const cookieB = await makeDriver(admin, ts, "B", "H-BB 2");
  check("driver A login", !!cookieA);
  check("driver B login", !!cookieB);

  const a = connectDriver(cookieA);
  const b = connectDriver(cookieB);
  // Beide driver:state-Waiter VOR dem await aufsetzen – sonst verpassen wir das
  // (sofort nach Verbindung gesendete) Event des zweiten Fahrers.
  const stateA = waitFor(a, "driver:state", 15000);
  const stateB = waitFor(b, "driver:state", 15000);
  await Promise.all([stateA, stateB]);

  // Beide FREI + an HBF
  a.emit("driver:location", HBF);
  b.emit("driver:location", HBF);
  await emitAck(a, "driver:status", { status: "FREI" });
  await emitAck(b, "driver:status", { status: "FREI" });
  await sleep(400);
  const offersA = collect(a, "driver:offer");
  const offersB = collect(b, "driver:offer");

  // ---- Teil 1: Competitive Dispatch ----
  console.log("Teil 1: Competitive Dispatch (erster gewinnt)");
  const bk1 = await bookNear(HBF, KROEPCKE, "1", ts);
  check("booking1 created", bk1.status === 201, bk1.body);
  const bid1 = bk1.body.id;
  const [oa, ob] = await Promise.all([
    offersA.match((o) => o.id === bid1, 30000),
    offersB.match((o) => o.id === bid1, 30000),
  ]);
  check("both drivers offered booking1", oa.id === bid1 && ob.id === bid1, { a: oa.id, b: ob.id });

  // A nimmt an, B muss offerCancel bekommen
  const cancelB = waitFor(b, "driver:offerCancel", 10000, (p) => p.bookingId === bid1);
  const ackA = await emitAck(a, "driver:respond", { bookingId: bid1, accept: true });
  check("A accept ack ok", ackA && ackA.ok === true, ackA);
  await cancelB.then(() => check("B got offerCancel", true)).catch((e) => check("B got offerCancel", false, e.message));
  await sleep(600);
  let b1 = (await api(`/api/bookings/${bid1}`)).body;
  check("booking1 assigned to A", b1.status === "ZUGEWIESEN" && b1.driver && b1.driver.vehiclePlate === "H-AA 1", {
    status: b1.status,
    plate: b1.driver && b1.driver.vehiclePlate,
  });

  // ---- Teil 2: ONLINE_RESERVED_NEXT_TRIP ----
  console.log("Teil 2: Reservierte Folgefahrt (near completion)");
  // B pausieren, damit nur A (besetzt + ziel-nah) Kandidat ist.
  await emitAck(b, "driver:status", { status: "PAUSE" });
  // A faehrt ans Ziel von booking1 -> near completion (<300 m).
  a.emit("driver:location", KROEPCKE);
  await sleep(600);

  const bk2 = await bookNear(KROEPCKE, HBF, "2", ts);
  check("booking2 created", bk2.status === 201, bk2.body);
  const bid2 = bk2.body.id;
  const oa2 = await offersA.match((o) => o.id === bid2, 30000);
  check("near-completion driver A offered booking2", oa2.id === bid2, oa2.id);

  const ackA2 = await emitAck(a, "driver:respond", { bookingId: bid2, accept: true });
  check("A accept booking2 ack ok", ackA2 && ackA2.ok === true, ackA2);
  await sleep(600);
  let b2 = (await api(`/api/bookings/${bid2}`)).body;
  check("booking2 reserved (RESERVIERT_FAHRER)", b2.trackingStatus === "RESERVIERT_FAHRER", b2.trackingStatus);
  check("booking2 isReserved flag", b2.isReserved === true, b2.isReserved);

  // A schliesst booking1 ab -> booking2 wird automatisch promotet.
  await emitAck(a, "driver:trip", { bookingId: bid1, action: "complete" });
  await sleep(800);
  b1 = (await api(`/api/bookings/${bid1}`)).body;
  b2 = (await api(`/api/bookings/${bid2}`)).body;
  check("booking1 completed", b1.status === "ABGESCHLOSSEN", b1.status);
  check("booking2 promoted to FAHRER_UNTERWEGS", b2.trackingStatus === "FAHRER_UNTERWEGS", b2.trackingStatus);
  check("booking2 no longer reserved", b2.isReserved === false, b2.isReserved);

  a.close();
  b.close();
  console.log(failures === 0 ? "\nParallel-E2E OK – alle Checks bestanden." : `\nParallel-E2E FEHLGESCHLAGEN – ${failures} Check(s) rot.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Parallel-E2E abgebrochen:", e.message);
  process.exit(1);
});
