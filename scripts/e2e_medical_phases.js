// E2E Krankenfahrten-Ausbau (Phasen B–F):
//   B) Detailfelder (Mobilität, Begleitung, Ausstattung, Kostenträger, Patient)
//      werden persistiert und im Booking-DTO zurückgegeben.
//   C) Dokumenten-Upload + Admin-Prüfung (PENDING -> APPROVED).
//   D) Fahrzeug-Anforderung requiresRamp: nur ein Fahrer MIT Rampe erhält das
//      Angebot, ein freigegebener Fahrer OHNE Rampe nicht.
//   E) Einrichtungs-Portal: Registrierung, Patient anlegen, Fahrt anlegen +
//      disponiert, Fahrtenliste.
//   F) Zugriffsprotokoll enthält Einträge (CREATE document etc.).
// Aufruf: node scripts/e2e_medical_phases.js [baseUrl]
/* eslint-disable no-console */
const BASE = process.argv[2] || "http://127.0.0.1:3000";
const { io } = require("socket.io-client");

const HBF = { lat: 52.3759, lng: 9.732 };
const KROEPCKE = { lat: 52.3719, lng: 9.7385 };

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  PASS ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`); }
}

async function api(path, opts = {}, cookie) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
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
function collect(socket, event) {
  const buf = [];
  socket.on(event, (p) => buf.push(p));
  return {
    has: (f) => buf.some(f),
    waitFor(f, timeoutMs = 20000) {
      const found = buf.find(f);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const iv = setInterval(() => { const x = buf.find(f); if (x) { clearInterval(iv); clearTimeout(to); resolve(x); } }, 150);
        const to = setTimeout(() => { clearInterval(iv); reject(new Error(`timeout ${event}`)); }, timeoutMs);
      });
    },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function verifyToken(phone) {
  const req = await api("/api/verify/request", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone }) });
  const code = req.body && req.body.devCode;
  if (!code) return null;
  const con = await api("/api/verify/confirm", { method: "POST", body: JSON.stringify({ channel: "SMS", target: phone, code }) });
  return con.body && con.body.token;
}

async function connectDriver(cookie) {
  const socket = io(BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: cookie }, transports: ["websocket", "polling"], forceNew: true });
  await waitFor(socket, "connect");
  await waitFor(socket, "driver:state");
  const offers = collect(socket, "driver:offer");
  socket.emit("driver:location", HBF);
  await new Promise((res) => socket.emit("driver:status", { status: "FREI" }, res));
  await sleep(400);
  return { socket, offers };
}

async function main() {
  const ts = Date.now();
  console.log("1) Setup: Firma + 2 WHEELCHAIR-Fahrer (beide medical), nur einer MIT Rampe");
  const reg = await api("/api/companies/register", { method: "POST", body: JSON.stringify({ name: `TEST_MPH_${ts}`, email: `mph+${ts}@test.com`, password: "Pass1234", cityTier: "SMALL" }) });
  check("company registered", reg.status === 201 || reg.status === 200, reg.body);
  const adminCookie = reg.cookie;
  // Wird fuer Phase C gebraucht: medizinische Dokumente sind nach Mandant
  // getrennt. Eine plattformweite Buchung ohne Firma gehoert noch niemandem,
  // also sieht sie auch kein Unternehmen – das ist so gewollt.
  const companySlug = reg.body?.company?.slug ?? reg.body?.slug ?? null;

  const drvRamp = await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "Ramp Fahrer", username: `mphr${ts}`, password: "Pass1234", vehicleClass: "WHEELCHAIR", medicalAllowed: true, hasRamp: true }) }, adminCookie);
  check("ramp driver created (medical+ramp)", drvRamp.body?.driver?.medicalAllowed === true && drvRamp.body?.driver?.hasRamp === true, drvRamp.body?.driver);
  const drvNoRamp = await api("/api/admin/drivers", { method: "POST", body: JSON.stringify({ name: "NoRamp Fahrer", username: `mphn${ts}`, password: "Pass1234", vehicleClass: "WHEELCHAIR", medicalAllowed: true, hasRamp: false }) }, adminCookie);
  check("noramp driver created (medical, no ramp)", drvNoRamp.body?.driver?.medicalAllowed === true && drvNoRamp.body?.driver?.hasRamp === false, drvNoRamp.body?.driver);

  const loginRamp = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `mphr${ts}`, password: "Pass1234" }) });
  const loginNoRamp = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: `mphn${ts}`, password: "Pass1234" }) });
  const ramp = await connectDriver(loginRamp.cookie);
  const noramp = await connectDriver(loginNoRamp.cookie);

  console.log("2) Phase B: Buchung mit allen Detailfeldern -> persistiert im DTO");
  const phoneB = "0151610" + (ts % 1000);
  const tokenB = await verifyToken(phoneB);
  const bookB = await api("/api/bookings", { method: "POST", body: JSON.stringify({
    ...(companySlug ? { company: companySlug } : {}),
    customerName: "Besteller B", customerPhone: phoneB,
    pickupAddress: "HBF", pickup: HBF, destAddress: "Dialyse", dest: KROEPCKE,
    vehicleClass: "WHEELCHAIR", medicalType: "DIALYSE",
    patientName: "Oma Erna", patientBirthDate: "1940-05-01",
    mobility: "WHEELCHAIR", companions: 1,
    medicalEquipment: ["OXYGEN", "WHEELCHAIR"],
    payerType: "INSURANCE", insuranceName: "AOK", insuranceNumber: "A123456789",
    verificationToken: tokenB,
  }) });
  check("Phase B booking created", bookB.status === 201, bookB.body);
  const bidB = bookB.body?.id;
  const got = await api(`/api/bookings/${bidB}`);
  check("B: patientName persisted", got.body?.patientName === "Oma Erna", got.body?.patientName);
  check("B: mobility persisted", got.body?.mobility === "WHEELCHAIR", got.body?.mobility);
  check("B: mobilityLabel present", !!got.body?.mobilityLabel, got.body?.mobilityLabel);
  check("B: companions persisted", got.body?.companions === 1, got.body?.companions);
  check("B: equipment persisted", Array.isArray(got.body?.medicalEquipment) && got.body.medicalEquipment.includes("OXYGEN"), got.body?.medicalEquipment);
  check("B: payerType persisted", got.body?.payerType === "INSURANCE", got.body?.payerType);
  check("B: insuranceNumber persisted", got.body?.insuranceNumber === "A123456789", got.body?.insuranceNumber);

  console.log("3) Phase C: Dokument-Upload + Admin-Prüfung");
  // Die API laesst fuer Verordnungen bewusst nur PDF/Bild zu (Schutz vor
  // gespeichertem Schadcode durch HTML/SVG). Der Test lud frueher eine .txt
  // hoch und schlug deshalb zu Recht fehl -> jetzt eine minimale PDF-Datei.
  const minimalPdf = ["%PDF-1.4", "1 0 obj<</Type/Catalog>>endobj", "trailer<</Root 1 0 R>>", "%%EOF"].join("\n");
  const up = await api("/api/medical/documents", { method: "POST", body: JSON.stringify({ kind: "VERORDNUNG", fileName: "verordnung.pdf", mimeType: "application/pdf", dataBase64: Buffer.from(minimalPdf).toString("base64"), bookingId: bidB }) });
  check("C: document uploaded", up.status === 201, up.body);
  const docId = up.body?.document?.id;
  const list = await api("/api/medical/documents?status=PENDING", {}, adminCookie);
  check("C: admin sees pending document", Array.isArray(list.body?.documents) && list.body.documents.some((d) => d.id === docId), list.body?.documents?.length);
  const appr = await api(`/api/medical/documents/${docId}`, { method: "PATCH", body: JSON.stringify({ reviewStatus: "APPROVED" }) }, adminCookie);
  check("C: document approved", appr.body?.document?.reviewStatus === "APPROVED", appr.body?.document);

  console.log("4) Phase D: requiresRamp -> nur Rampen-Fahrer bekommt das Angebot");
  const phoneD = "0151620" + (ts % 1000);
  const tokenD = await verifyToken(phoneD);
  const bookD = await api("/api/bookings", { method: "POST", body: JSON.stringify({
    customerName: "Besteller D", customerPhone: phoneD,
    pickupAddress: "HBF", pickup: HBF, destAddress: "Klinik", dest: KROEPCKE,
    vehicleClass: "WHEELCHAIR", medicalType: "KRANKENHAUS", requiresRamp: true,
    verificationToken: tokenD,
  }) });
  check("Phase D booking created", bookD.status === 201, bookD.body);
  const bidD = bookD.body?.id;
  let rampGot = false;
  try { rampGot = !!(await ramp.offers.waitFor((o) => o.id === bidD, 15000)); } catch {}
  check("D: ramp driver received offer", rampGot);
  await sleep(1500);
  check("D: noramp driver did NOT receive offer", !noramp.offers.has((o) => o.id === bidD));

  // Das Angebot aus Phase D haengt sonst offen und der Rampen-Fahrer bleibt
  // gebunden – Phase E wuerde ihm dann gar kein neues Angebot schicken.
  // Also ausdruecklich ablehnen, damit er wieder frei ist.
  await new Promise((res) => ramp.socket.emit("driver:respond", { bookingId: bidD, accept: false }, res));
  await sleep(800);

  console.log("5) Phase E: Einrichtungs-Portal (Registrierung, Patient, Fahrt)");
  const instReg = await api("/api/institutions/register", { method: "POST", body: JSON.stringify({ name: `Dialysezentrum ${ts}`, type: "DIALYSE", email: `inst+${ts}@test.com`, password: "Pass1234", phone: "0511999" }) });
  check("E: institution registered", instReg.status === 201, instReg.body);
  const instCookie = instReg.cookie;
  const me = await api("/api/institutions/me", {}, instCookie);
  check("E: institution session works", me.body?.institution?.name?.includes("Dialysezentrum"), me.body?.institution);
  const pat = await api("/api/institutions/patients", { method: "POST", body: JSON.stringify({ name: "Patient Müller", birthDate: "1955-03-03", mobility: "WHEELCHAIR" }) }, instCookie);
  check("E: patient created", pat.status === 201, pat.body);
  const patientId = pat.body?.patient?.id;
  // Fahrten aus dem Einrichtungs-Portal gehen standardmaessig an die Disposition
  // (dispatchMode ADMIN). Nur mit quickOrder wird sofort ein Fahrer gesucht –
  // und genau das prueft die folgende Zusicherung.
  const instRide = await api("/api/institutions/rides", { method: "POST", body: JSON.stringify({ patientId, pickup: { address: "Heim", ...HBF }, dest: { address: "Dialyse", ...KROEPCKE }, medicalType: "DIALYSE", vehicleClass: "WHEELCHAIR", quickOrder: true }) }, instCookie);
  check("E: institution ride created", instRide.status === 201, instRide.body);
  const instRideId = instRide.body?.id;
  const ridesList = await api("/api/institutions/rides", {}, instCookie);
  check("E: ride appears in institution list", Array.isArray(ridesList.body?.rides) && ridesList.body.rides.some((r) => r.id === instRideId), ridesList.body?.rides?.length);
  // Eine freigegebene Fahrt (kein Rampenzwang) sollte einem medical-Fahrer angeboten werden.
  let instOffered = false;
  try { instOffered = !!(await ramp.offers.waitFor((o) => o.id === instRideId, 15000)); } catch {}
  check("E: institution ride was dispatched to a medical driver", instOffered);

  console.log("6) Phase F: Zugriffsprotokoll enthält Einträge");
  const log = await api("/api/admin/accesslog", {}, adminCookie);
  check("F: access log has entries", Array.isArray(log.body?.entries) && log.body.entries.length > 0, log.body?.entries?.length);
  check("F: document create logged", log.body?.entries?.some((e) => e.entity === "MEDICAL_DOCUMENT" && e.action === "CREATE"), true);
  check("F: document approve logged", log.body?.entries?.some((e) => e.entity === "MEDICAL_DOCUMENT" && e.action === "APPROVE"), true);

  console.log("7) Phase B Rückfahrt: returnAt erzeugt zweite, geplante Fahrt (vertauschte Strecke)");
  const phoneR = "0151630" + (ts % 1000);
  const tokenR = await verifyToken(phoneR);
  const ret = await api("/api/bookings", { method: "POST", body: JSON.stringify({
    customerName: "Rück Tester", customerPhone: phoneR,
    pickupAddress: "Heim", pickup: HBF, destAddress: "Dialysezentrum", dest: KROEPCKE,
    vehicleClass: "WHEELCHAIR", medicalType: "DIALYSE",
    returnAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    verificationToken: tokenR,
  }) });
  check("return outbound created", ret.status === 201, ret.body);
  check("return booking id returned", !!ret.body?.returnBookingId, ret.body?.returnBookingId);
  const retGet = await api(`/api/bookings/${ret.body?.returnBookingId}`);
  check("return is scheduled", retGet.body?.isScheduled === true, retGet.body?.isScheduled);
  check("return route swapped (pickup = orig. dest)", retGet.body?.pickupAddress === "Dialysezentrum", retGet.body?.pickupAddress);

  console.log("8) Phase C: zweites Dokument als GENEHMIGUNG");
  // Ebenfalls PDF: text/plain ist bewusst nicht erlaubt (siehe Phase C oben).
  const up2 = await api("/api/medical/documents", { method: "POST", body: JSON.stringify({ kind: "GENEHMIGUNG", fileName: "genehmigung.pdf", mimeType: "application/pdf", dataBase64: Buffer.from(minimalPdf).toString("base64"), bookingId: bidB }) });
  check("C: GENEHMIGUNG uploaded with correct kind", up2.body?.document?.kind === "GENEHMIGUNG", up2.body?.document);

  console.log("9) Phase E: Monats-Abrechnung der Einrichtung");
  const inv = await api("/api/institutions/invoice", {}, instCookie);
  check("E: invoice returns ride count >= 1", typeof inv.body?.rides === "number" && inv.body.rides >= 1, inv.body?.rides);
  check("E: invoice has billable total field", typeof inv.body?.totalBillable === "number", inv.body && Object.keys(inv.body));

  console.log("10) Phase E: PDF-Abrechnung");
  const pdfRes = await fetch(BASE + "/api/institutions/invoice/pdf", { headers: { Cookie: instCookie } });
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  check("E: PDF status 200", pdfRes.status === 200, pdfRes.status);
  check("E: PDF content-type", (pdfRes.headers.get("content-type") || "").includes("application/pdf"), pdfRes.headers.get("content-type"));
  check("E: PDF starts with %PDF magic bytes", pdfBuf.slice(0, 4).toString() === "%PDF", pdfBuf.slice(0, 8).toString());
  check("E: PDF non-trivial size", pdfBuf.length > 800, pdfBuf.length);

  ramp.socket.disconnect();
  noramp.socket.disconnect();
  console.log(failures === 0 ? "\nE2E OK – alle Checks bestanden." : `\nE2E FEHLER – ${failures} Check(s) fehlgeschlagen.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
