// E2E Rechnungs-Archiv (Phase 6): Fahrt abschliessen -> Rechnung festschreiben
// (idempotent) -> Archiv/PDF -> als überfällig backdaten -> Mahnung -> Zahlung
// erfassen (Zahlungsabgleich). Aufruf: node scripts/e2e_invoice_archive.js [baseUrl]
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
const { PDFDocument } = require("pdf-lib");
const { PrismaClient } = require("@prisma/client");

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
  const buf = [], waiters = [];
  socket.on(event, (p) => {
    const i = waiters.findIndex((w) => w.filter(p));
    if (i >= 0) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(p); } else buf.push(p);
  });
  return {
    match(filter, ms = 25000) {
      const i = buf.findIndex(filter);
      if (i >= 0) return Promise.resolve(buf.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { filter, resolve, timer: setTimeout(() => reject(new Error("timeout " + event)), ms) };
        waiters.push(w);
      });
    },
  };
}
function waitFor(socket, event, ms = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout " + event)), ms);
    socket.once(event, (p) => { clearTimeout(t); resolve(p); });
  });
}

async function main() {
  const prisma = new PrismaClient();
  const ts = Date.now();
  const month = new Date().toISOString().slice(0, 7);

  console.log("Setup: Firma + abgeschlossene Fahrt");
  const reg = await json("/api/companies/register", {
    method: "POST",
    body: JSON.stringify({ name: `TEST_ARCH_${ts}`, email: `arch+${ts}@test.com`, password: "Pass1234", cityTier: "BIG" }),
  });
  const admin = reg.cookie;
  const slug = reg.body.slug || (reg.body.company && reg.body.company.slug);
  await json("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "Arch Fahrer", username: `archd${ts}`, password: "Pass1234", vehiclePlate: "H-AR 1" }) }, admin);
  const login = await json("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `archd${ts}`, password: "Pass1234" }) });
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: login.cookie }, transports: ["polling", "websocket"], forceNew: true });
  await waitFor(socket, "driver:state");
  socket.emit("driver:location", HBF);
  await emitAck(socket, "driver:status", { status: "FREI" });
  await sleep(400);
  const offers = collect(socket, "driver:offer");
  const phone = "0511246" + (ts % 1000);
  const vq = await json("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const vc = await json("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code: vq.body.devCode }) });
  const bk = await json("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ company: slug, customerName: "Arch", customerPhone: phone, pickupAddress: "HBF", pickup: HBF, destAddress: "Kröpcke", dest: KROEPCKE, paymentMethod: "CASH", verificationToken: vc.body.token }),
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

  console.log("Festschreiben (issue) + Idempotenz");
  const iss1 = await json(`/api/admin/invoices/${month}/issue`, { method: "POST" }, admin);
  check("issue ok + created", iss1.status === 200 && iss1.body.created === true, iss1.body);
  check("status OFFEN", iss1.body.invoice && iss1.body.invoice.status === "OFFEN", iss1.body.invoice && iss1.body.invoice.status);
  const invId = iss1.body.invoice.id;
  const invNo = iss1.body.invoice.invoiceNo;
  const iss2 = await json(`/api/admin/invoices/${month}/issue`, { method: "POST" }, admin);
  check("issue idempotent (created=false)", iss2.status === 200 && iss2.body.created === false, iss2.body);

  console.log("Archiv-Liste + archiviertes PDF");
  const arch = await json("/api/admin/invoices", {}, admin);
  check("archive lists invoice", (arch.body.invoices || []).some((i) => i.invoiceNo === invNo), arch.body.invoices);
  const pdfRes = await api(`/api/admin/invoices/id/${invId}`, {}, admin);
  const buf = Buffer.from(await pdfRes.res.arrayBuffer());
  check("archived PDF is %PDF", buf.slice(0, 5).toString() === "%PDF-");
  let pages = 0;
  try { pages = (await PDFDocument.load(buf)).getPageCount(); } catch {}
  check("archived PDF parses", pages >= 1, pages);

  console.log("Super: Archiv-Liste + Überfälligkeit");
  const sup = (await json("/api/auth/login", { method: "POST", body: JSON.stringify(SUPER) })).cookie;
  const all1 = await json("/api/super/invoices", {}, sup);
  check("super sees invoice (open)", all1.body.invoices.some((i) => i.id === invId), invId);
  check("totals.open > 0", all1.body.totals.open > 0, all1.body.totals);

  // Fälligkeit in die Vergangenheit setzen -> überfällig
  await prisma.invoice.update({ where: { id: invId }, data: { dueAt: new Date(Date.now() - 86400000) } });
  const overdue = await json("/api/super/invoices?overdue=1", {}, sup);
  check("invoice now overdue", overdue.body.invoices.some((i) => i.id === invId && i.overdue), overdue.body.totals);

  console.log("Mahnung senden");
  const remind = await json(`/api/super/invoices/id/${invId}`, { method: "POST", body: JSON.stringify({ action: "remind" }) }, sup);
  check("remind ok (mock)", remind.status === 200 && remind.body.ok === true, remind.body);
  check("remindersSent incremented", remind.body.invoice && remind.body.invoice.remindersSent === 1, remind.body.invoice && remind.body.invoice.remindersSent);

  console.log("Zahlungsabgleich: als bezahlt markieren");
  const pay = await json(`/api/super/invoices/id/${invId}`, { method: "POST", body: JSON.stringify({ action: "pay", ref: "BANK-REF-123" }) }, sup);
  check("pay -> BEZAHLT", pay.status === 200 && pay.body.invoice.status === "BEZAHLT", pay.body.invoice && pay.body.invoice.status);
  check("paidAt + paymentRef set", pay.body.invoice.paidAt && pay.body.invoice.paymentRef === "BANK-REF-123", pay.body.invoice);
  const paidList = await json("/api/super/invoices?status=BEZAHLT", {}, sup);
  check("appears in paid filter + totals.paid>0", paidList.body.invoices.some((i) => i.id === invId) && paidList.body.totals.paid > 0, paidList.body.totals);

  // archiviertes PDF nach Zahlung weiterhin valide (mit BEZAHLT-Stempel)
  const pdf2 = Buffer.from(await (await api(`/api/admin/invoices/id/${invId}`, {}, sup)).res.arrayBuffer());
  check("paid archived PDF still valid", pdf2.slice(0, 5).toString() === "%PDF-");

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nArchive-E2E OK – alle Checks bestanden." : `\nArchive-E2E FEHLGESCHLAGEN – ${failures} rot.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Archive-E2E abgebrochen:", e.message);
  process.exit(1);
});
