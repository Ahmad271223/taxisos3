// Gemeinsame Helfer fuer die QA-/E2E-Skripte (scripts/qa/*).
// Aufruf der Tests jeweils: node scripts/qa/<test>.js [baseUrl]
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const { io } = require("socket.io-client");

const BASE = process.env.QA_BASE || "http://127.0.0.1:3000";

// Hinweis: Testserver bitte mit SMS_DISABLED=1 starten, damit automatisierte
// Laeufe kein echtes SMS-Kontingent verbrauchen. Der SMS-Code-Pfad inklusive
// Protokoll und Doppelversand-Sperre laeuft dabei unveraendert weiter.

// ---- Reporting -----------------------------------------------------------
const results = [];
let failures = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log(`  PASS ${name}`);
    results.push({ name, ok: true });
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`);
    results.push({ name, ok: false, extra });
  }
  return !!cond;
}
function info(msg) {
  console.log(`  INFO ${msg}`);
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}
function finish(label) {
  const passed = results.filter((r) => r.ok).length;
  console.log(
    failures === 0
      ? `\nOK ${label} – ${passed}/${results.length} Checks bestanden.`
      : `\nFEHLGESCHLAGEN ${label} – ${failures} von ${results.length} rot.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// ---- HTTP ----------------------------------------------------------------
async function raw(path, opts = {}, cookie) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const sc = res.headers.get("set-cookie");
  return { res, status: res.status, cookie: sc ? sc.split(";")[0] : null };
}
async function api(path, opts, cookie) {
  const r = await raw(path, opts, cookie);
  let body = null;
  try {
    body = await r.res.json();
  } catch {
    /* kein JSON */
  }
  return { status: r.status, body, cookie: r.cookie };
}
const post = (p, data, cookie) => api(p, { method: "POST", body: JSON.stringify(data) }, cookie);
const patch = (p, data, cookie) => api(p, { method: "PATCH", body: JSON.stringify(data) }, cookie);
const del = (p, cookie) => api(p, { method: "DELETE" }, cookie);
const get = (p, cookie) => api(p, {}, cookie);

// ---- Zeit / Utils --------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = () => Date.now() + Math.floor(Math.random() * 100000);
const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };
const LIST = { lat: 52.3906, lng: 9.7554 };

// ---- Sockets -------------------------------------------------------------
const emitAck = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));
function waitFor(socket, event, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout " + event)), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });
}
// Sammelt Events und erlaubt spaeteres Warten auf ein passendes (ohne Race).
function collect(socket, event) {
  const buf = [];
  const waiting = [];
  socket.on(event, (p) => {
    const i = waiting.findIndex((w) => w.f(p));
    if (i >= 0) {
      const w = waiting.splice(i, 1)[0];
      clearTimeout(w.t);
      w.resolve(p);
    } else buf.push(p);
  });
  return {
    all: () => buf.slice(),
    count: () => buf.length,
    match(f, ms = 25000) {
      const i = buf.findIndex(f);
      if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { f, resolve, t: setTimeout(() => reject(new Error("timeout " + event)), ms) };
        waiting.push(w);
      });
    },
  };
}
function connectSocket(cookie, role) {
  return io(BASE, {
    auth: role ? { role } : undefined,
    extraHeaders: { Cookie: cookie },
    transports: ["polling", "websocket"],
    forceNew: true,
  });
}

// ---- Fachliche Bausteine -------------------------------------------------
// Firma registrieren (liefert Admin-Cookie + slug).
async function registerCompany(tag, extra = {}) {
  const id = uniq();
  const r = await post("/api/companies/register", {
    name: `QA_${tag}_${id}`,
    email: `qa+${tag}${id}@test.com`,
    password: "Pass1234",
    cityTier: "SMALL",
    ...extra,
  });
  const slug = r.body?.slug || r.body?.company?.slug;
  return { status: r.status, body: r.body, admin: r.cookie, slug, id };
}

// Fahrer anlegen + einloggen + Socket verbinden (FREI an Position pos).
async function createDriver(adminCookie, tag, pos = HBF, extra = {}) {
  const id = uniq();
  const username = `qad${tag}${id}`;
  const created = await post(
    "/api/admin/drivers",
    { name: `QA Fahrer ${tag}`, username, password: "Pass1234", vehiclePlate: `H-QA ${String(id).slice(-3)}`, ...extra },
    adminCookie,
  );
  const login = await post("/api/auth/login", { role: "DRIVER", username, password: "Pass1234" });
  return { created, username, cookie: login.cookie, driverId: created.body?.driver?.id, pos };
}
async function goOnline(driverCookie, pos = HBF) {
  const socket = connectSocket(driverCookie, "driver");
  await waitFor(socket, "driver:state");
  socket.emit("driver:location", pos);
  await emitAck(socket, "driver:status", { status: "FREI" });
  await sleep(400);
  return socket;
}

// Gast-Verifizierung (liefert Token + Telefonnummer).
async function verifiedPhone(seed = uniq()) {
  const phone = "+4915" + String(seed).slice(-9);
  const req = await post("/api/verify/request", { channel: "SMS", target: phone });
  if (!req.body?.devCode) return { token: null, phone, req };
  const conf = await post("/api/verify/confirm", { channel: "SMS", target: phone, code: req.body.devCode });
  return { token: conf.body?.token ?? null, phone, req, conf };
}

// Standardbuchung (CASH), optional scheduledAt / weitere Felder.
async function book(slug, opts = {}) {
  const phone = opts.customerPhone || "+4915" + String(uniq()).slice(-9);
  return post("/api/bookings", {
    company: slug,
    customerName: opts.customerName || "QA Kunde",
    customerPhone: phone,
    pickupAddress: opts.pickupAddress || "Hauptbahnhof",
    pickup: opts.pickup || HBF,
    destAddress: opts.destAddress || "Kröpcke",
    dest: opts.dest || KROEPCKE,
    paymentMethod: opts.paymentMethod || "CASH",
    ...(opts.scheduledAt ? { scheduledAt: opts.scheduledAt } : {}),
    ...(opts.extra || {}),
  });
}

module.exports = {
  BASE, check, info, section, finish, results,
  raw, api, get, post, patch, del,
  sleep, uniq, HBF, KROEPCKE, LIST,
  emitAck, waitFor, collect, connectSocket,
  registerCompany, createDriver, goOnline, verifiedPhone, book,
};
