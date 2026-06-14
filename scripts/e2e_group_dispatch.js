// E2E (Phase 13 Gruppen-/Eventbuchung): eine Gruppe mit 2 Fahrzeugen wird auf
// ZWEI verschiedene Fahrer verteilt (Dispatch-Dedupe bei Annahme). Jeder Fahrer
// nimmt gezielt EIN Fahrzeug an – so wie in der echten App.
// Aufruf: node scripts/e2e_group_dispatch.js [baseUrl]
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

// Puffert driver:offer-Events und erlaubt das Warten auf ein bestimmtes.
function collect(socket, event) {
  const buf = [];
  socket.on(event, (p) => buf.push(p));
  return {
    waitFor(filter, timeoutMs = 20000) {
      const found = buf.find(filter);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const iv = setInterval(() => {
          const f = buf.find(filter);
          if (f) {
            clearInterval(iv);
            clearTimeout(to);
            resolve(f);
          }
        }, 100);
        const to = setTimeout(() => {
          clearInterval(iv);
          reject(new Error(`timeout ${event}`));
        }, timeoutMs);
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setupDriver(ts, idx, adminCookie) {
  const uname = `grpdrv${ts}_${idx}`;
  const drv = await api(
    "/api/admin/drivers",
    { method: "POST", body: JSON.stringify({ name: `Grp Fahrer ${idx}`, username: uname, password: "Pass1234", vehiclePlate: `H-GR ${idx}`, vehicleClass: "STANDARD" }) },
    adminCookie,
  );
  check(`driver ${idx} created`, drv.status === 201 || drv.status === 200, drv.body);
  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: uname, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  const offers = collect(socket, "driver:offer");
  socket.emit("driver:location", HBF);
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  return { socket, offers };
}

function accept(socket, bookingId) {
  return new Promise((res) => socket.emit("driver:respond", { bookingId, accept: true }, res));
}

async function driverIdFor(gid, childId) {
  for (let i = 0; i < 20; i++) {
    const gs = await api(`/api/groups/${gid}`);
    const b = ((gs.body && gs.body.group && gs.body.group.bookings) || []).find((x) => x.id === childId);
    if (b && b.driverId) return b.driverId;
    await sleep(700);
  }
  return null;
}

async function main() {
  const ts = Date.now();
  console.log("1) Setup: Firma + 2 STANDARD-Fahrer");
  const reg = await api("/api/companies/register", {
    method: "POST",
    body: JSON.stringify({ name: `TEST_GRP_${ts}`, email: `grp+${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }),
  });
  check("company registered", reg.status === 200 || reg.status === 201, reg.body);
  const adminCookie = reg.cookie;

  const d1 = await setupDriver(ts, 1, adminCookie);
  const d2 = await setupDriver(ts, 2, adminCookie);
  await sleep(800);

  console.log("2) Telefon verifizieren + Gruppe mit 2 Fahrzeugen buchen");
  const phone = "0166" + (ts % 10000000);
  const vReq = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const vCon = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: vReq.body.devCode }) });
  const token = vCon.body && vCon.body.token;

  const grp = await api("/api/groups", {
    method: "POST",
    body: JSON.stringify({
      customerName: "Grp E2E",
      customerPhone: phone,
      pickupAddress: "HBF Hannover",
      pickup: HBF,
      destAddress: "Kröpcke",
      dest: KROEPCKE,
      vehicles: [{ vehicleClass: "STANDARD", count: 2 }],
      totalPassengers: 6,
      verificationToken: token,
    }),
  });
  check("group created", grp.status === 201, grp.body);
  const children = (grp.body && grp.body.group && grp.body.group.bookings) || [];
  check("2 child bookings", children.length === 2, children);
  const gid = grp.body.id;
  const [c0, c1] = children.map((b) => b.id);

  console.log("3) Fahrer 1 nimmt Fahrzeug 1, Fahrer 2 nimmt Fahrzeug 2");
  await d1.offers.waitFor((o) => o.id === c0, 20000);
  await accept(d1.socket, c0);
  const drv1 = await driverIdFor(gid, c0);
  check("vehicle 1 assigned", !!drv1, drv1);

  await d2.offers.waitFor((o) => o.id === c1, 20000);
  await accept(d2.socket, c1);
  const drv2 = await driverIdFor(gid, c1);
  check("vehicle 2 assigned", !!drv2, drv2);

  check("drivers are DISTINCT (group spread)", !!drv1 && !!drv2 && drv1 !== drv2, { drv1, drv2 });

  d1.socket.disconnect();
  d2.socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
