// E2E Provisions-Rechnung (Phase 4): einen Auftrag real abschliessen und dann
// pruefen, dass die Monats-Rechnung die Fahrt enthaelt, USt/Brutto stimmen und
// das erzeugte PDF ein gueltiges, parsebares Dokument ist.
// Aufruf: node scripts/e2e_invoice.js [baseUrl]
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");
const { PDFDocument } = require("pdf-lib");

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
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const sc = r.headers.get("set-cookie");
  return { status: r.status, res: r, cookie: sc ? sc.split(";")[0] : null };
}
async function json(path, opts, cookie) {
  const r = await api(path, opts, cookie);
  let b = null;
  try {
    b = await r.res.json();
  } catch {}
  return { status: r.status, body: b, cookie: r.cookie };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emitAck = (s, ev, p) => new Promise((res) => s.emit(ev, p, res));
function waitFor(socket, event, timeoutMs = 25000, filter = () => true) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, h);
      reject(new Error("timeout " + event));
    }, timeoutMs);
    function h(p) {
      if (!filter(p)) return;
      clearTimeout(t);
      socket.off(event, h);
      resolve(p);
    }
    socket.on(event, h);
  });
}

async function main() {
  const ts = Date.now();
  const month = new Date().toISOString().slice(0, 7);
  const VAT = 0.19;

  console.log("Setup: Firma (BIG=7%) + Fahrer");
  const reg = await json("/api/companies/register", {
    method: "POST",
    body: JSON.stringify({ name: `TEST_INV_${ts}`, email: `inv+${ts}@test.com`, password: "Pass1234", cityTier: "BIG" }),
  });
  check("company registered", reg.status === 200 || reg.status === 201, reg.body);
  const admin = reg.cookie;
  const slug = reg.body.slug || (reg.body.company && reg.body.company.slug);

  await json("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "INV Fahrer", username: `invd${ts}`, password: "Pass1234", vehiclePlate: "H-IV 1" }) }, admin);
  const login = await json("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `invd${ts}`, password: "Pass1234" }) });
  const driverCookie = login.cookie;

  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: driverCookie }, transports: ["polling", "websocket"], forceNew: true });
  await waitFor(socket, "driver:state", 15000);
  socket.emit("driver:location", HBF);
  await emitAck(socket, "driver:status", { status: "FREI" });
  await sleep(400);

  console.log("Auftrag (Firma) verifizieren, buchen, abschliessen");
  const phone = "0511654" + (ts % 1000);
  const vq = await json("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const vc = await json("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: vq.body.devCode }) });

  const offerP = waitFor(socket, "driver:offer", 30000);
  const bk = await json("/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      company: slug,
      customerName: "INV Kunde",
      customerPhone: phone,
      pickupAddress: "HBF Hannover",
      pickup: HBF,
      destAddress: "Kröpcke",
      dest: KROEPCKE,
      paymentMethod: "CASH",
      verificationToken: vc.body.token,
    }),
  });
  check("booking created", bk.status === 201, bk.body);
  const bid = bk.body.id;
  await offerP;
  await emitAck(socket, "driver:respond", { bookingId: bid, accept: true });
  await sleep(400);
  await emitAck(socket, "driver:trip", { bookingId: bid, action: "arrived" });
  await emitAck(socket, "driver:trip", { bookingId: bid, action: "start" });
  await emitAck(socket, "driver:trip", { bookingId: bid, action: "complete" });
  await sleep(600);
  const done = (await json(`/api/bookings/${bid}`)).body;
  check("trip completed with platformFee", done.status === "ABGESCHLOSSEN" && done.platformFee > 0, {
    status: done.status,
    fee: done.platformFee,
  });
  socket.close();

  console.log("Rechnung prüfen (JSON)");
  const inv = await json(`/api/admin/invoices/${month}?format=json`, {}, admin);
  check("invoice json 200", inv.status === 200, inv.status);
  const d = inv.body;
  check("invoice has >=1 line", d.trips >= 1 && d.lines.length >= 1, d.trips);
  check("line rate is 7% (BIG)", d.lines.every((l) => l.rate === 0.07), d.lines.map((l) => l.rate));
  const sumFees = Math.round(d.lines.reduce((s, l) => s + l.fee, 0) * 100) / 100;
  check("net == sum of line fees", d.net === sumFees, { net: d.net, sumFees });
  check("vat == net * 0.19", d.vat === Math.round(d.net * VAT * 100) / 100, { net: d.net, vat: d.vat });
  check("gross == net + vat", d.gross === Math.round((d.net + d.vat) * 100) / 100, { gross: d.gross });
  check("invoiceNo format", /^RE-\d{6}-/.test(d.invoiceNo), d.invoiceNo);

  console.log("Rechnung prüfen (PDF)");
  const pdfRes = await api(`/api/admin/invoices/${month}`, {}, admin);
  check("pdf 200 application/pdf", pdfRes.status === 200 && (pdfRes.res.headers.get("content-type") || "").includes("application/pdf"));
  const buf = Buffer.from(await pdfRes.res.arrayBuffer());
  check("pdf magic %PDF", buf.slice(0, 5).toString() === "%PDF-", buf.slice(0, 5).toString());
  const outPath = require("path").join(require("os").tmpdir(), `taxios_invoice_${month}.pdf`);
  require("fs").writeFileSync(outPath, buf);
  console.log("  (PDF gespeichert:", outPath + ")");
  let pages = 0;
  try {
    const doc = await PDFDocument.load(buf);
    pages = doc.getPageCount();
  } catch (e) {
    /* invalid */
  }
  check("pdf parses as valid document (>=1 page)", pages >= 1, pages);

  console.log("Auth-Schutz");
  const noAuth = await json(`/api/admin/invoices/${month}`);
  check("no-auth -> 401", noAuth.status === 401, noAuth.status);

  console.log(failures === 0 ? "\nInvoice-E2E OK – alle Checks bestanden." : `\nInvoice-E2E FEHLGESCHLAGEN – ${failures} rot.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Invoice-E2E abgebrochen:", e.message);
  process.exit(1);
});
