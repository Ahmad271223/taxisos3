// E2E ECHTE Stripe-Kartenzahlung (Stripe TESTMODUS, kein echtes Geld).
// Beweist den vollen Pfad: PaymentIntent -> Karte bestätigen (simuliert den
// Browser per pm_card_visa) -> buchen -> Capture nach Fahrtende -> BEZAHLT;
// plus 402 ohne Intent und Void bei Storno. Aufruf: node scripts/e2e_stripe_live.js [baseUrl]
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };

let failures = 0;
function check(n, c, x) { if (c) console.log(`  PASS ${n}`); else { failures++; console.log(`  FAIL ${n}${x !== undefined ? " -> " + JSON.stringify(x) : ""}`); } }
async function api(p, o = {}, c) { const r = await fetch(BASE + p, { ...o, headers: { "Content-Type": "application/json", ...(c ? { Cookie: c } : {}), ...(o.headers || {}) } }); const sc = r.headers.get("set-cookie"); return { status: r.status, res: r, cookie: sc ? sc.split(";")[0] : null }; }
async function json(p, o, c) { const r = await api(p, o, c); let b = null; try { b = await r.res.json(); } catch {} return { status: r.status, body: b, cookie: r.cookie }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emitAck = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));
function collect(socket, event) { const buf = [], w = []; socket.on(event, (p) => { const i = w.findIndex((x) => x.f(p)); if (i >= 0) { const x = w.splice(i, 1)[0]; clearTimeout(x.t); x.r(p); } else buf.push(p); }); return { match(f, ms = 25000) { const i = buf.findIndex(f); if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]); return new Promise((r, j) => { const x = { f, r, t: setTimeout(() => j(new Error("timeout " + event)), ms) }; w.push(x); }); } }; }
function waitFor(s, e, ms = 15000) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout " + e)), ms); s.once(e, (p) => { clearTimeout(t); res(p); }); }); }

async function setupDriverCompany(tag) {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const reg = await json("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `TEST_STR_${tag}_${ts}`, email: `str+${tag}${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  const admin = reg.cookie, slug = reg.body.slug || (reg.body.company && reg.body.company.slug);
  await json("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "Str Fahrer", username: `strd${tag}${ts}`, password: "Pass1234", vehiclePlate: "H-ST 1" }) }, admin);
  const login = await json("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `strd${tag}${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["polling", "websocket"], forceNew: true });
  await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF);
  await emitAck(socket, "driver:status", { status: "FREI" });
  await sleep(400);
  return { admin, slug, socket, ts };
}

async function verifiedToken(ts) {
  const phone = "0511" + (ts % 1000000);
  const vq = await json("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const vc = await json("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: vq.body.devCode }) });
  return { token: vc.body.token, phone };
}

async function authorizedIntent(slug) {
  // 1) Intent über die App anlegen (Betrag serverseitig)
  const intent = await json("/api/payments/intent", { method: "POST", body: JSON.stringify({ pickup: HBF, dest: KROEPCKE, company: slug }) });
  check("intent: enabled + clientSecret", intent.body.enabled === true && !!intent.body.clientSecret && intent.body.mock === false, { enabled: intent.body.enabled, mock: intent.body.mock });
  const piId = intent.body.paymentIntentId;
  // 2) Karte bestätigen wie der Browser (Stripe Elements) – Test-PM pm_card_visa
  const confirmed = await stripe.paymentIntents.confirm(piId, { payment_method: "pm_card_visa" });
  check("intent confirmed -> requires_capture", confirmed.status === "requires_capture", confirmed.status);
  return { piId, amount: intent.body.amount };
}

async function main() {
  console.log("Stripe-Key:", (process.env.STRIPE_SECRET_KEY || "").slice(0, 12) + "…");

  // ---------- A) Voller Flow: authorize -> book -> capture -> BEZAHLT ----------
  console.log("A) Authorize -> Buchen -> Capture");
  const A = await setupDriverCompany("A");
  const offersA = collect(A.socket, "driver:offer");
  const v = await verifiedToken(A.ts);
  const { piId, amount } = await authorizedIntent(A.slug);

  const bk = await json("/api/bookings", { method: "POST", body: JSON.stringify({ company: A.slug, customerName: "Stripe", customerPhone: v.phone, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, paymentMethod: "CARD", verificationToken: v.token, paymentIntentId: piId }) });
  check("booking 201", bk.status === 201, { s: bk.status, b: bk.body });
  check("paymentStatus AUTORISIERT", bk.body.booking.paymentStatus === "AUTORISIERT", bk.body.booking && bk.body.booking.paymentStatus);
  check("priceAuthorized = Hold-Betrag", Math.round(bk.body.booking.priceAuthorized * 100) === amount, { pa: bk.body.booking.priceAuthorized, amount });
  const bid = bk.body.id;

  await offersA.match((o) => o.id === bid, 30000);
  await emitAck(A.socket, "driver:respond", { bookingId: bid, accept: true });
  await sleep(300);
  await emitAck(A.socket, "driver:trip", { bookingId: bid, action: "arrived" });
  await emitAck(A.socket, "driver:trip", { bookingId: bid, action: "start" });
  await emitAck(A.socket, "driver:trip", { bookingId: bid, action: "complete" });
  await sleep(800);
  const done = (await json(`/api/bookings/${bid}`)).body;
  check("booking BEZAHLT", done.paymentStatus === "BEZAHLT", done.paymentStatus);
  // Direkt bei Stripe prüfen
  const piPaid = await stripe.paymentIntents.retrieve(piId);
  check("Stripe PI succeeded", piPaid.status === "succeeded", piPaid.status);
  check("amount_received = Fahrpreis (gedeckelt)", piPaid.amount_received === Math.round(Math.min(done.fare, done.priceAuthorized) * 100), { recv: piPaid.amount_received, fare: done.fare });
  A.socket.close();

  // ---------- B) 402 ohne Intent ----------
  console.log("B) CARD ohne Intent -> 402");
  const B = await setupDriverCompany("B");
  const vb = await verifiedToken(B.ts + 7);
  const noIntent = await json("/api/bookings", { method: "POST", body: JSON.stringify({ company: B.slug, customerName: "NoIntent", customerPhone: vb.phone, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, paymentMethod: "CARD", verificationToken: vb.token }) });
  check("ohne Intent -> 402", noIntent.status === 402, noIntent.status);
  B.socket.close();

  // ---------- C) Storno -> Void ----------
  console.log("C) Storno -> Void (Autorisierung freigegeben)");
  const C = await setupDriverCompany("C");
  const vc2 = await verifiedToken(C.ts + 13);
  const { piId: piC } = await authorizedIntent(C.slug);
  const bkC = await json("/api/bookings", { method: "POST", body: JSON.stringify({ company: C.slug, customerName: "Void", customerPhone: vc2.phone, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, paymentMethod: "CARD", verificationToken: vc2.token, paymentIntentId: piC }) });
  const bidC = bkC.body.id;
  await sleep(200);
  const cancel = await json(`/api/bookings/${bidC}/cancel`, { method: "POST", body: JSON.stringify({ reason: "stripe void test" }) });
  check("cancel ok", cancel.status === 200 || cancel.status === 201, cancel.status);
  await sleep(400);
  const cb = (await json(`/api/bookings/${bidC}`)).body;
  check("booking STORNIERT", cb.paymentStatus === "STORNIERT", cb.paymentStatus);
  const piVoid = await stripe.paymentIntents.retrieve(piC);
  check("Stripe PI canceled", piVoid.status === "canceled", piVoid.status);
  C.socket.close();

  console.log(failures === 0 ? "\nStripe-LIVE-E2E OK – alle Checks bestanden (Testmodus)." : `\nStripe-LIVE-E2E FEHLGESCHLAGEN – ${failures} rot.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("Stripe-LIVE-E2E abgebrochen:", e.message); process.exit(1); });
