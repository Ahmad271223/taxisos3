// QA/Regression: die ZWEI Deadlock-Pfade, die das Fahrer-Dashboard einfrieren.
//
// Bug A ("Neustart-Vergiftung"): dispatch.init() laedt ALLE ZUGEWIESEN/AKTIV
//   Buchungen in driverActiveBooking – auch reservierte ZUKUNFTS-Fahrten.
//   Danach gilt der Fahrer als "in Fahrt": die naechste angenommene Fahrt wird
//   RESERVIERT_FAHRER + Fahrerstatus RESERVIERT. In DriverPortal sind fuer
//   RESERVIERT_FAHRER ALLE drei Trip-Buttons disabled -> Sackgasse.
//   Ablauf: --setup, dann Serverneustart, dann --verify.
//
// Bug B ("faellige Vorbestellung"): reserveScheduled setzt trackingStatus nicht.
//   Eine faellige Vorbestellung steht nach dem Sweep auf SUCHE; wird sie
//   reserviert, bleibt SUCHE + status ZUGEWIESEN -> driverState haelt sie fuer
//   die aktive Fahrt -> Dashboard blockiert.
//
// Aufruf:
//   node scripts/qa/freeze_deadlock.js --bugB          (ohne Neustart)
//   node scripts/qa/freeze_deadlock.js --setup         (Zustand anlegen)
//   <Server neu starten>
//   node scripts/qa/freeze_deadlock.js --verify
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const H = require("./helpers");
const { check, info, section, finish, sleep, emitAck, collect, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const STATE_FILE = path.join(__dirname, ".freeze_state.json");
// UI-Phasen, in denen DriverPortal die Trip-Buttons freischaltet.
const UI_ACTIONABLE = ["FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT"];

function latest(states) {
  const all = states.all();
  return all.length ? all[all.length - 1] : null;
}
async function afterState(states, action) {
  const before = states.count();
  const ack = await action();
  for (let i = 0; i < 40 && states.count() === before; i++) await sleep(100);
  return { ack, state: latest(states) };
}

// ---------------------------------------------------------------------------
async function bugB() {
  section("BUG B: faellige Vorbestellung (trackingStatus SUCHE) reservieren");
  const co = await H.registerCompany("BUGB");
  const d1 = await H.createDriver(co.admin, "B1", HBF);
  const s1 = await H.goOnline(d1.cookie, HBF);
  const states = collect(s1, "driver:state");

  const sched = await H.book(co.slug, {
    customerName: "Faellig Kunde",
    scheduledAt: new Date(Date.now() + 90 * 60_000).toISOString(),
  });
  const id = sched.body?.id;
  check("Vorbestellung angelegt", sched.status === 201, sched.status);

  // Zustand nachstellen, den der Sweep bei Faelligkeit erzeugt:
  // Buchung wird in die normale Disposition geworfen -> trackingStatus SUCHE,
  // bleibt aber OFFEN/ohne Fahrer (kein freier Fahrer im Radius).
  await prisma.booking.update({ where: { id }, data: { trackingStatus: "SUCHE" } });
  info("DB praepariert: trackingStatus=SUCHE, status=OFFEN, driverId=null (Zustand nach Sweep)");

  const r = await afterState(states, () => emitAck(s1, "driver:reserve", { bookingId: id }));
  check("driver:reserve angenommen", r.ack?.ok === true, r.ack);
  await sleep(400);

  const db = await prisma.booking.findUnique({
    where: { id },
    select: { status: true, trackingStatus: true, isReserved: true },
  });
  info(`DB nach reserve: status=${db?.status} trackingStatus=${db?.trackingStatus} isReserved=${db?.isReserved}`);
  check(
    "trackingStatus ist GEPLANT (nicht SUCHE)",
    db?.trackingStatus === "GEPLANT",
    { ist: db?.trackingStatus, erwartet: "GEPLANT" },
  );
  check("isReserved = true", db?.isReserved === true, db?.isReserved);

  const st = r.state;
  info(`driver:state -> status=${st?.status}, activeBooking=${st?.activeBooking?.id ?? "null"} (${st?.activeBooking?.trackingStatus ?? "-"})`);
  check(
    "Zukunftsfahrt ist NICHT activeBooking (sonst friert das Dashboard ein)",
    !st?.activeBooking,
    { activeBooking: st?.activeBooking?.id, trackingStatus: st?.activeBooking?.trackingStatus },
  );
  check("Fahrer bleibt FREI", st?.status === "FREI", st?.status);
  check("Fahrt erscheint unter myScheduled", (st?.myScheduled ?? []).some((b) => b.id === id));

  s1.close();
}

// ---------------------------------------------------------------------------
async function setup() {
  section("BUG A – Teil 1: Zustand anlegen (danach Server neu starten)");
  const co = await H.registerCompany("BUGA");
  const d1 = await H.createDriver(co.admin, "A1", HBF);
  const s1 = await H.goOnline(d1.cookie, HBF);

  const sched = await H.book(co.slug, {
    customerName: "Zukunft Kunde",
    scheduledAt: new Date(Date.now() + 6 * 3600_000).toISOString(),
  });
  const schedId = sched.body?.id;
  check("Vorbestellung (6 h) angelegt", sched.status === 201, sched.status);
  const r = await emitAck(s1, "driver:reserve", { bookingId: schedId });
  check("Fahrer reserviert die Zukunftsfahrt", r?.ok === true, r);
  await sleep(500);

  const db = await prisma.booking.findUnique({ where: { id: schedId }, select: { status: true, trackingStatus: true } });
  info(`Reservierte Zukunftsfahrt: status=${db?.status} trackingStatus=${db?.trackingStatus}`);
  check("Zustand fuer Neustart-Test vorbereitet (status=ZUGEWIESEN)", db?.status === "ZUGEWIESEN", db?.status);

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ slug: co.slug, admin: co.admin, driverCookie: d1.cookie, driverId: d1.driverId, schedId }, null, 2),
  );
  s1.close();
  console.log(`\n>>> Zustand gespeichert. Jetzt den Dev-Server NEU STARTEN, dann:\n>>> node scripts/qa/freeze_deadlock.js --verify\n`);
}

async function verify() {
  section("BUG A – Teil 2: nach Serverneustart eine SOFORT-Fahrt annehmen");
  const st0 = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  const s1 = await H.goOnline(st0.driverCookie, HBF);
  const states = collect(s1, "driver:state");
  const offers = collect(s1, "driver:offer");

  const db0 = await prisma.booking.findUnique({ where: { id: st0.schedId }, select: { status: true, trackingStatus: true } });
  info(`Reservierte Zukunftsfahrt existiert weiterhin: status=${db0?.status} trackingStatus=${db0?.trackingStatus}`);

  const now = await H.book(st0.slug, { customerName: "Sofort nach Neustart", pickup: HBF, dest: LIST });
  check("Sofortbuchung angelegt", now.status === 201, now.status);
  const nowId = now.body?.id;

  let got = true;
  try {
    await offers.match((o) => o.id === nowId, 25000);
  } catch {
    got = false;
  }
  check("Fahrer erhaelt das Angebot", got);
  if (!got) {
    s1.close();
    return;
  }

  const acc = await afterState(states, () => emitAck(s1, "driver:respond", { bookingId: nowId, accept: true }));
  check("Angebot annehmbar", acc.ack?.ok === true, acc.ack);
  await sleep(600);

  const dbNow = await prisma.booking.findUnique({ where: { id: nowId }, select: { trackingStatus: true, isReserved: true } });
  const drv = await prisma.driver.findUnique({ where: { id: st0.driverId }, select: { status: true } });
  info(`Sofortfahrt nach Annahme: trackingStatus=${dbNow?.trackingStatus} isReserved=${dbNow?.isReserved} | Fahrerstatus=${drv?.status}`);

  check(
    "Sofortfahrt ist FAHRER_UNTERWEGS (nicht RESERVIERT_FAHRER)",
    dbNow?.trackingStatus === "FAHRER_UNTERWEGS",
    { ist: dbNow?.trackingStatus, hinweis: "RESERVIERT_FAHRER sperrt im UI alle drei Trip-Buttons" },
  );
  check("Fahrerstatus ist BESETZT (nicht RESERVIERT)", drv?.status === "BESETZT", drv?.status);

  const st = acc.state;
  check("activeBooking zeigt die Sofortfahrt", st?.activeBooking?.id === nowId, {
    ist: st?.activeBooking?.id,
    erwartet: nowId,
  });
  check(
    "activeBooking ist in einer bedienbaren UI-Phase",
    UI_ACTIONABLE.includes(st?.activeBooking?.trackingStatus),
    { trackingStatus: st?.activeBooking?.trackingStatus, erlaubt: UI_ACTIONABLE },
  );

  // Der entscheidende Beweis: die Fahrt laesst sich zu Ende fahren.
  for (const action of ["arrived", "start", "complete"]) {
    const r = await emitAck(s1, "driver:trip", { bookingId: nowId, action });
    check(`Trip-Aktion "${action}" wirkt`, r?.ok === true, r);
    await sleep(250);
  }
  const done = await prisma.booking.findUnique({ where: { id: nowId }, select: { status: true, trackingStatus: true } });
  check("Fahrt abgeschlossen", done?.status === "ABGESCHLOSSEN" && done?.trackingStatus === "BEENDET", done);

  const dbSched = await prisma.booking.findUnique({ where: { id: st0.schedId }, select: { status: true, trackingStatus: true } });
  check("Geplante Fahrt weiterhin intakt", dbSched?.status === "ZUGEWIESEN" && dbSched?.trackingStatus === "GEPLANT", dbSched);

  s1.close();
}

// ---------------------------------------------------------------------------
async function main() {
  const arg = process.argv.find((a) => a.startsWith("--")) ?? "--bugB";
  if (arg === "--setup") await setup();
  else if (arg === "--verify") await verify();
  else await bugB();
  await prisma.$disconnect();
  finish("FREEZE-DEADLOCK" + (arg === "--bugB" ? " (Bug B)" : arg === "--setup" ? " (Setup)" : " (Bug A)"));
}
main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
