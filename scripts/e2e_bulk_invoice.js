// E2E Sammel-Abrechnung (Phase 5): einen abrechenbaren Auftrag erzeugen, dann
// als Super-Admin die Monats-ZIP ziehen, ENTPACKEN und die enthaltenen PDFs +
// die Übersichts-CSV pruefen; anschliessend den Sammel-E-Mail-Versand testen.
// Aufruf: node scripts/e2e_bulk_invoice.js [baseUrl]
/* eslint-disable no-console */

// ---------------------------------------------------------------------------
// STILLGELEGT: Die Provisions-Sammelrechnung rechnet nur die Provision pro
// Fahrt ab – und die ist abgeschafft (Einnahmen laufen ueber das Monats-Abo).
// Dieses Skript prueft also ein Modul, das es im Betrieb nicht mehr gibt.
// Reaktivieren fuer eine Auswertung: INVOICE_MODULE=1 (auch am Server setzen).
// Die Stilllegung selbst prueft scripts/qa/invoice_retired.js.
// ---------------------------------------------------------------------------
if (process.env.INVOICE_MODULE !== "1") {
  console.log("UEBERSPRUNGEN – Provisions-Sammelrechnung ist stillgelegt.");
  process.exit(0);
}

const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");
const JSZip = require("jszip");
const { PDFDocument } = require("pdf-lib");

const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };
// Zugangsdaten NICHT im Repository hinterlegen – sie landen sonst dauerhaft im
// Git-Verlauf. Aus der Umgebung lesen (siehe .env).
const SUPER = {
  email: process.env.SUPER_ADMIN_EMAIL ?? "",
  password: process.env.SUPER_ADMIN_PASSWORD ?? "",
  role: "ADMIN",
};

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
        const w = { filter, resolve, timer: setTimeout(() => reject(new Error("timeout " + event)), timeoutMs) };
        waiters.push(w);
      });
    },
  };
}
function waitFor(socket, event, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout " + event)), ms);
    socket.once(event, (p) => {
      clearTimeout(t);
      resolve(p);
    });
  });
}

async function main() {
  const ts = Date.now();
  const month = new Date().toISOString().slice(0, 7);

  console.log("Setup: abrechenbare Firma (1 Fahrt abschliessen)");
  const reg = await json("/api/companies/register", {
    method: "POST",
    body: JSON.stringify({ name: `TEST_BULK_${ts}`, email: `bulk+${ts}@test.com`, password: "Pass1234", cityTier: "BIG" }),
  });
  const admin = reg.cookie;
  const slug = reg.body.slug || (reg.body.company && reg.body.company.slug);
  await json("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "Bulk Fahrer", username: `bulkd${ts}`, password: "Pass1234", vehiclePlate: "H-BK 1" }) }, admin);
  const login = await json("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `bulkd${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["polling", "websocket"], forceNew: true });
  await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF);
  await emitAck(socket, "driver:status", { status: "FREI" });
  await sleep(400);
  const offers = collect(socket, "driver:offer");
  const phone = "0511321" + (ts % 1000);
  const vq = await json("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const vc = await json("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: vq.body.devCode }) });
  const bk = await json("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ company: slug, customerName: "Bulk", customerPhone: phone, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, paymentMethod: "CASH", verificationToken: vc.body.token }),
  });
  const bid = bk.body.id;
  await offers.match((o) => o.id === bid, 30000);
  await emitAck(socket, "driver:respond", { bookingId: bid, accept: true });
  await sleep(300);
  await emitAck(socket, "driver:trip", { bookingId: bid, action: "arrived" });
  await emitAck(socket, "driver:trip", { bookingId: bid, action: "start" });
  await emitAck(socket, "driver:trip", { bookingId: bid, action: "complete" });
  await sleep(500);
  socket.close();
  // Provision pro Fahrt ist abgeschafft (Einnahmen laufen ueber das Monatsabo).
  // Geprueft wird daher: Fahrt sauber beendet, Fahrpreis vorhanden, Provision 0.
  const fertig = (await json(`/api/bookings/${bid}`)).body;
  check("trip completed with fare", fertig.status === "ABGESCHLOSSEN" && fertig.fare > 0, {
    status: fertig.status, fare: fertig.fare,
  });
  check("no per-ride commission charged", (fertig.platformFee ?? 0) === 0, fertig.platformFee);

  console.log("Super-Admin: Sammel-Vorschau (JSON)");
  const sup = await json("/api/auth/login", { method: "POST", body: JSON.stringify(SUPER) });
  const superCookie = sup.cookie;
  check("super login", sup.status === 200 && sup.body.role === "SUPER_ADMIN", sup.body);
  const preview = await json(`/api/super/invoices/${month}?format=json`, {}, superCookie);
  check("preview 200", preview.status === 200);
  const row = preview.body.rows.find((r) => r.slug === slug);
  // Die Firma taucht in der Vorschau auf, ihr Provisionsbetrag ist aber 0 –
  // genau so ist das Geschaeftsmodell gewollt.
  check("our company appears in the preview", !!row, row);
  check("commission is zero", row && row.net === 0, row?.net);
  check("totals present", !!preview.body.totals, preview.body.totals);

  console.log("Super-Admin: ZIP herunterladen + entpacken");
  const zipRes = await api(`/api/super/invoices/${month}`, {}, superCookie);
  check("zip 200 application/zip", zipRes.status === 200 && (zipRes.res.headers.get("content-type") || "").includes("application/zip"));
  const zipBuf = Buffer.from(await zipRes.res.arrayBuffer());
  check("zip magic PK", zipBuf.slice(0, 2).toString() === "PK", zipBuf.slice(0, 4).toString("hex"));
  const zip = await JSZip.loadAsync(zipBuf);
  const names = Object.keys(zip.files);
  check("zip contains uebersicht CSV", names.some((n) => n.startsWith("uebersicht-") && n.endsWith(".csv")), names);
  const ourPdfName = `Provisionsrechnung-${slug}-${month}.pdf`;
  check("zip contains our company PDF", names.includes(ourPdfName), names);
  if (names.includes(ourPdfName)) {
    const pdfBytes = await zip.file(ourPdfName).async("uint8array");
    check("PDF in zip is %PDF", Buffer.from(pdfBytes.slice(0, 5)).toString() === "%PDF-");
    let pages = 0;
    try {
      pages = (await PDFDocument.load(pdfBytes)).getPageCount();
    } catch {}
    check("PDF in zip parses (>=1 page)", pages >= 1, pages);
  }
  const csvName = names.find((n) => n.startsWith("uebersicht-"));
  const csv = await zip.file(csvName).async("string");
  check("CSV lists our company", csv.includes(slug), csvName);

  console.log("Super-Admin: Sammel-E-Mail-Versand");
  const send = await json(`/api/super/invoices/${month}/send`, { method: "POST" }, superCookie);
  check("send 200", send.status === 200, send.status);
  check("at least our invoice sent", send.body.sent >= 1 && send.body.failed === 0, send.body);
  check("mock mode (no resend key locally)", send.body.mock === true, send.body.mock);

  console.log(failures === 0 ? "\nBulk-Invoice-E2E OK – alle Checks bestanden." : `\nBulk-Invoice-E2E FEHLGESCHLAGEN – ${failures} rot.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Bulk-Invoice-E2E abgebrochen:", e.message);
  process.exit(1);
});
