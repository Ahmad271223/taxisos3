// QA/Regression: Fahrer nimmt eine ZUKUENFTIGE Vorbestellung an.
// Reproduziert den "eingefrorenen Dashboard"-Bug: prueft exakt den
// driver:state, den der Client nach dem Reservieren erhaelt, plus den
// DB-Zustand der Buchung. Aufruf: node scripts/qa/scheduled_freeze.js
/* eslint-disable no-console */
const H = require("./helpers");
const { check, info, section, finish, sleep, emitAck, collect, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Letztes gepushtes driver:state holen (wird nach reserve/respond/trip gesendet).
function latest(states) {
  const all = states.all();
  return all.length ? all[all.length - 1] : null;
}
async function nextState(states, action) {
  const before = states.count();
  const r = await action();
  for (let i = 0; i < 40 && states.count() === before; i++) await sleep(100);
  return { ack: r, state: latest(states) };
}

async function main() {
  section("Setup: Firma + 2 Fahrer online");
  const co = await H.registerCompany("FRZ");
  check("Firma registriert", co.status === 201 || co.status === 200, co.status);
  const d1 = await H.createDriver(co.admin, "A", HBF);
  const d2 = await H.createDriver(co.admin, "B", HBF);
  const s1 = await H.goOnline(d1.cookie, HBF);
  const s2 = await H.goOnline(d2.cookie, HBF);
  const states1 = collect(s1, "driver:state");
  const offers1 = collect(s1, "driver:offer");

  // ---------------------------------------------------------------
  section("1) Vorbestellung fuer spaeter heute (in 3 Stunden)");
  const sched = await H.book(co.slug, {
    customerName: "Spaet Kunde",
    scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
  });
  check("Vorbestellung angelegt (201)", sched.status === 201, { s: sched.status, b: sched.body });
  const schedId = sched.body?.id;
  check("isScheduled = true", sched.body?.booking?.isScheduled === true, sched.body?.booking?.isScheduled);
  check("trackingStatus = GEPLANT", sched.body?.booking?.trackingStatus === "GEPLANT", sched.body?.booking?.trackingStatus);

  // ---------------------------------------------------------------
  section("2) Fahrer A reserviert die geplante Fahrt");
  const res1 = await nextState(states1, () => emitAck(s1, "driver:reserve", { bookingId: schedId }));
  check("driver:reserve ok", res1.ack?.ok === true, res1.ack);
  await sleep(500);

  const dbAfter = await prisma.booking.findUnique({
    where: { id: schedId },
    select: { status: true, trackingStatus: true, driverId: true, isReserved: true, acceptedAt: true },
  });
  info(`DB nach Reservierung: status=${dbAfter?.status} trackingStatus=${dbAfter?.trackingStatus} isReserved=${dbAfter?.isReserved} acceptedAt=${dbAfter?.acceptedAt ? "gesetzt" : "null"}`);

  // KERN: Der Bug ist trackingStatus="SUCHE" statt "GEPLANT"
  check(
    "DB: trackingStatus bleibt GEPLANT (nicht SUCHE)",
    dbAfter?.trackingStatus === "GEPLANT",
    { ist: dbAfter?.trackingStatus, erwartet: "GEPLANT" },
  );
  check("DB: isReserved = true", dbAfter?.isReserved === true, dbAfter?.isReserved);

  // ---------------------------------------------------------------
  section("3) KERNPRUEFUNG: driver:state, das der Client erhaelt");
  const st1 = res1.state;
  info(`Fahrerstatus: ${st1?.status}`);
  info(`activeBooking: ${st1?.activeBooking ? st1.activeBooking.id + " (" + st1.activeBooking.trackingStatus + ")" : "null"}`);
  info(`myScheduled: ${(st1?.myScheduled ?? []).length}, openScheduled: ${(st1?.openScheduled ?? []).length}`);

  check(
    "activeBooking ist NULL (sonst sperrt DriverPortal alle Buttons)",
    !st1?.activeBooking,
    { activeBooking: st1?.activeBooking?.id, trackingStatus: st1?.activeBooking?.trackingStatus },
  );
  check("Fahrer bleibt FREI (Fahrt ist erst in 3 h)", st1?.status === "FREI", st1?.status);
  check(
    "Geplante Fahrt erscheint unter myScheduled",
    (st1?.myScheduled ?? []).some((b) => b.id === schedId),
    (st1?.myScheduled ?? []).map((b) => b.id),
  );
  check(
    "Reservierte Fahrt nicht mehr in openScheduled",
    !(st1?.openScheduled ?? []).some((b) => b.id === schedId),
  );

  // ---------------------------------------------------------------
  section("4) Dashboard weiter benutzbar: Status wechseln + neuer Auftrag");
  // Status wechseln muss moeglich bleiben (im UI sind die Buttons sonst disabled).
  await emitAck(s1, "driver:status", { status: "PAUSE" });
  await sleep(300);
  await emitAck(s1, "driver:status", { status: "FREI" });
  await sleep(300);
  const drvRow = await prisma.driver.findUnique({ where: { id: d1.driverId }, select: { status: true } });
  check("Statuswechsel PAUSE->FREI wirkt", drvRow?.status === "FREI", drvRow?.status);

  // Fahrer B pausieren, damit nur A in Frage kommt.
  await emitAck(s2, "driver:status", { status: "PAUSE" });
  await sleep(400);
  const now = await H.book(co.slug, { customerName: "Sofort Kunde", pickup: HBF, dest: LIST });
  check("Sofortbuchung angelegt", now.status === 201, now.status);
  const nowId = now.body?.id;
  let gotOffer = true;
  try {
    await offers1.match((o) => o.id === nowId, 20000);
  } catch {
    gotOffer = false;
  }
  check("Fahrer erhaelt trotz geplanter Fahrt neue Sofort-Auftraege", gotOffer);

  if (gotOffer) {
    const acc = await nextState(states1, () => emitAck(s1, "driver:respond", { bookingId: nowId, accept: true }));
    check("Sofortauftrag annehmbar", acc.ack?.ok === true, acc.ack);
    const st2 = acc.state;
    check("Jetzt ist die SOFORT-Fahrt die aktive Fahrt (nicht die geplante!)", st2?.activeBooking?.id === nowId, {
      active: st2?.activeBooking?.id,
      erwartet: nowId,
      hinweis: "Bei acceptedAt-NULLS-FIRST gewinnt sonst die Geisterfahrt",
    });
    check("Aktive Fahrt hat Live-Status FAHRER_UNTERWEGS", st2?.activeBooking?.trackingStatus === "FAHRER_UNTERWEGS", st2?.activeBooking?.trackingStatus);
    check("Geplante Fahrt weiterhin unter myScheduled", (st2?.myScheduled ?? []).some((b) => b.id === schedId));

    // Fahrt sauber durchspielen -> alle drei Trip-Buttons muessen greifen
    for (const action of ["arrived", "start", "complete"]) {
      const r = await emitAck(s1, "driver:trip", { bookingId: nowId, action });
      check(`Trip-Aktion "${action}" erfolgreich`, r?.ok === true, r);
      await sleep(300);
    }
    await sleep(600);
    const st3 = latest(states1);
    check("Nach Abschluss keine aktive Fahrt mehr", !st3?.activeBooking, st3?.activeBooking?.id);
    check("Geplante Fahrt unversehrt unter myScheduled", (st3?.myScheduled ?? []).some((b) => b.id === schedId));
  }

  // ---------------------------------------------------------------
  section("5) Vorbestellung 3 TAGE im Voraus");
  const far = await H.book(co.slug, {
    customerName: "Fern Kunde",
    scheduledAt: new Date(Date.now() + 3 * 24 * 3600_000).toISOString(),
  });
  check("Vorbestellung (3 Tage) angelegt", far.status === 201, far.status);
  const farId = far.body?.id;
  const res2 = await nextState(states1, () => emitAck(s1, "driver:reserve", { bookingId: farId }));
  check("Fahrt in 3 Tagen reservierbar", res2.ack?.ok === true, res2.ack);
  check("Fahrer bleibt FREI", res2.state?.status === "FREI", res2.state?.status);
  check("Fahrt in 3 Tagen NICHT activeBooking", !res2.state?.activeBooking, res2.state?.activeBooking?.id);
  check(
    "Beide geplanten Fahrten unter myScheduled",
    (res2.state?.myScheduled ?? []).length >= 2,
    (res2.state?.myScheduled ?? []).map((b) => b.id),
  );

  // ---------------------------------------------------------------
  section("6) Doppelvergabe verhindert");
  await emitAck(s2, "driver:status", { status: "FREI" });
  await sleep(300);
  const dbl = await emitAck(s2, "driver:reserve", { bookingId: schedId });
  check("Bereits reservierte Fahrt nicht doppelt vergebbar", dbl?.ok === false, dbl);

  // ---------------------------------------------------------------
  section("7) Neustart-Simulation: bleibt der Zustand sauber?");
  // Prueft die init()-Logik indirekt: eine reservierte Zukunftsfahrt darf den
  // Fahrer nach einem Reconnect nicht als "in Fahrt" markieren.
  s1.close();
  await sleep(800);
  const s1b = await H.goOnline(d1.cookie, HBF);
  const states1b = collect(s1b, "driver:state");
  await sleep(600);
  const stRe = latest(states1b) ?? (await (async () => {
    const p = H.waitFor(s1b, "driver:state", 5000).catch(() => null);
    return p;
  })());
  if (stRe) {
    check("Nach Reconnect: keine aktive Fahrt", !stRe.activeBooking, stRe.activeBooking?.id);
    check("Nach Reconnect: geplante Fahrten erhalten", (stRe.myScheduled ?? []).length >= 2, (stRe.myScheduled ?? []).length);
  } else info("Kein driver:state nach Reconnect erhalten");
  s1b.close();

  s2.close();
  await prisma.$disconnect();
  finish("SCHEDULED-FREEZE");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
