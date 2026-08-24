// QA: 30-Min-Rueckfrage an den Fahrer + Absage + Kunden-SMS + Ersatzfahrer.
// Deckt Punkt 8, 9 und die SMS-Pruefung aus Punkt 10 ab.
// Aufruf: node scripts/qa/driver_confirm_replace.js
/* eslint-disable no-console */
const H = require("./helpers");
const { check, info, section, finish, sleep, emitAck, collect, waitFor, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function latest(c) {
  const a = c.all();
  return a.length ? a[a.length - 1] : null;
}
async function afterState(states, action) {
  const before = states.count();
  const ack = await action();
  for (let i = 0; i < 40 && states.count() === before; i++) await sleep(100);
  return { ack, state: latest(states) };
}
const smsFor = (bookingId, kind) =>
  prisma.smsLog.findMany({ where: { bookingId, ...(kind ? { kind } : {}) }, orderBy: { createdAt: "asc" } });

async function main() {
  section("Setup: Firma + 2 Fahrer");
  const co = await H.registerCompany("CONF");
  const d1 = await H.createDriver(co.admin, "C1", HBF);
  const d2 = await H.createDriver(co.admin, "C2", HBF);
  const s1 = await H.goOnline(d1.cookie, HBF);
  const st1 = collect(s1, "driver:state");
  const ask1 = collect(s1, "driver:confirmScheduled");

  // ---------------------------------------------------------------
  section("1) Vorbestellung in 20 Minuten -> Rueckfrage muss kommen");
  // 20 Min < 30 Min Vorlauf -> der naechste Sweep stellt die Rueckfrage.
  const scheduledAt = new Date(Date.now() + 20 * 60_000);
  const bk = await H.book(co.slug, { customerName: "Ersatz Kunde", scheduledAt: scheduledAt.toISOString() });
  check("Vorbestellung angelegt", bk.status === 201, bk.status);
  const bid = bk.body?.id;
  const custPhone = bk.body?.booking?.customerPhone;

  const res = await afterState(st1, () => emitAck(s1, "driver:reserve", { bookingId: bid }));
  check("Fahrer reserviert die Fahrt", res.ack?.ok === true, res.ack);
  check("Fahrer bleibt FREI (Fahrt erst in 20 Min)", res.state?.status === "FREI", res.state?.status);

  info("Warte auf den Sweep (laeuft alle 20 s) …");
  let asked = null;
  try {
    asked = await ask1.match((p) => p.bookingId === bid, 45000);
  } catch {
    asked = null;
  }
  check("Fahrer erhaelt die Rueckfrage 'Fahrt weiterhin durchfuehren?'", !!asked, {
    hinweis: "driver:confirmScheduled wurde nicht empfangen",
  });
  if (asked) info(`Rueckfrage fuer ${asked.pickupAddress} → ${asked.destAddress}`);

  const dbAsked = await prisma.booking.findUnique({ where: { id: bid }, select: { driverConfirmAskedAt: true } });
  check("Rueckfrage-Zeitpunkt in der DB vermerkt", !!dbAsked?.driverConfirmAskedAt, dbAsked);

  // ---------------------------------------------------------------
  section("2) Keine doppelte Rueckfrage (mehrere Sweeps)");
  const countBefore = ask1.count();
  await sleep(25000); // mindestens ein weiterer Sweep
  check("Rueckfrage wird NICHT wiederholt", ask1.count() === countBefore, {
    vorher: countBefore,
    nachher: ask1.count(),
  });

  // ---------------------------------------------------------------
  section("3) Antwort 'Ja' -> Fahrt bleibt beim Fahrer");
  const yes = await afterState(st1, () => emitAck(s1, "driver:confirmScheduled", { bookingId: bid, keep: true }));
  check("Antwort 'Ja' angenommen", yes.ack?.ok === true, yes.ack);
  const dbYes = await prisma.booking.findUnique({
    where: { id: bid },
    select: { driverConfirmedAt: true, driverDeclinedAt: true, driverId: true },
  });
  check("driverConfirmedAt gesetzt", !!dbYes?.driverConfirmedAt, dbYes);
  check("Fahrt weiterhin beim Fahrer", dbYes?.driverId === d1.driverId, dbYes?.driverId);
  check("Noch KEINE Storno-SMS an den Kunden", (await smsFor(bid, "DRIVER_CANCELLED")).length === 0);

  // ---------------------------------------------------------------
  section("4) Antwort 'Nein' -> Fahrt noch NICHT storniert (nur Button erscheint)");
  const no = await afterState(st1, () => emitAck(s1, "driver:confirmScheduled", { bookingId: bid, keep: false }));
  check("Antwort 'Nein' angenommen", no.ack?.ok === true, no.ack);
  const dbNo = await prisma.booking.findUnique({
    where: { id: bid },
    select: { driverDeclinedAt: true, driverConfirmedAt: true, driverId: true, status: true },
  });
  check("driverDeclinedAt gesetzt", !!dbNo?.driverDeclinedAt, dbNo);
  check("driverConfirmedAt zurueckgesetzt", !dbNo?.driverConfirmedAt, dbNo);
  check("Fahrt ist NOCH NICHT storniert (Fahrer haengt noch dran)", dbNo?.driverId === d1.driverId && dbNo?.status === "ZUGEWIESEN", dbNo);
  check("Immer noch keine Storno-SMS", (await smsFor(bid, "DRIVER_CANCELLED")).length === 0);
  const declined = (no.state?.myScheduled ?? []).find((b) => b.id === bid);
  check("UI-Flag driverDeclinedAt kommt beim Fahrer an (Storno-Button)", !!declined?.driverDeclinedAt, declined);

  // ---------------------------------------------------------------
  section("5) 'Fahrt stornieren' -> Kunde per SMS informiert + Neuvermittlung");
  // Zweiter Fahrer online, damit ein Ersatz gefunden werden kann.
  const s2 = await H.goOnline(d2.cookie, HBF);
  const offers2 = collect(s2, "driver:offer");
  // Zuhoerer VOR der Freigabe registrieren, sonst wird der Push verpasst.
  const st2 = collect(s2, "driver:state");
  await sleep(500);

  const cancel = await afterState(st1, () => emitAck(s1, "driver:cancelScheduled", { bookingId: bid }));
  check("Stornierung angenommen", cancel.ack?.ok === true, cancel.ack);
  await sleep(1200);

  const dbRel = await prisma.booking.findUnique({
    where: { id: bid },
    select: { driverId: true, status: true, trackingStatus: true, reassignCount: true, declinedDriverIds: true },
  });
  info(`Nach Storno: driverId=${dbRel?.driverId} status=${dbRel?.status} trackingStatus=${dbRel?.trackingStatus} reassignCount=${dbRel?.reassignCount}`);
  check("Fahrt wieder freigegeben (kein Fahrer)", dbRel?.driverId === null, dbRel?.driverId);
  check("Status zurueck auf OFFEN", dbRel?.status === "OFFEN", dbRel?.status);
  // Fahrt ist erst in 20 Min -> sie geht zurueck in den Vorbestellungs-Pool
  // (GEPLANT), damit der Ersatzfahrer nicht sofort losfaehrt.
  check("Fahrt zurueck im Vorbestellungs-Pool (GEPLANT)", dbRel?.trackingStatus === "GEPLANT", dbRel?.trackingStatus);
  check("reassignCount hochgezaehlt", dbRel?.reassignCount === 1, dbRel?.reassignCount);
  check("Absagender Fahrer ist ausgeschlossen", (dbRel?.declinedDriverIds ?? "").includes(d1.driverId), dbRel?.declinedDriverIds);
  check("Fahrt verschwindet aus 'Meine geplanten Fahrten'", !(cancel.state?.myScheduled ?? []).some((b) => b.id === bid));

  const cancelSms = await smsFor(bid, "DRIVER_CANCELLED");
  check("Kunde erhaelt GENAU EINE Storno-SMS", cancelSms.length === 1, cancelSms.map((s) => s.status));
  if (cancelSms[0]) {
    info(`SMS an ${cancelSms[0].to}: "${cancelSms[0].body}"`);
    check("SMS-Text nennt Storno + Ersatzsuche", /storniert/i.test(cancelSms[0].body) && /neuen Fahrer/i.test(cancelSms[0].body), cancelSms[0].body);
    check("Empfaengernummer ist E.164 (+49…)", /^\+\d{8,15}$/.test(cancelSms[0].to), cancelSms[0].to);
  }

  // ---------------------------------------------------------------
  section("6) Ersatzfahrer uebernimmt -> Kunde erneut informiert");
  // Die freigegebene Vorbestellung erscheint bei allen Fahrern im Pool.
  await sleep(1500);
  const poolState = st2.all().slice(-1)[0];
  const inPool = (poolState?.openScheduled ?? []).some((b) => b.id === bid);
  check("Freigegebene Fahrt erscheint sofort bei anderen Fahrern", inPool, {
    openScheduled: (poolState?.openScheduled ?? []).map((b) => b.id),
  });

  {
    const acc = await emitAck(s2, "driver:reserve", { bookingId: bid });
    check("Ersatzfahrer uebernimmt die Fahrt", acc?.ok === true, acc);
    await sleep(1500);
    const dbNew = await prisma.booking.findUnique({ where: { id: bid }, select: { driverId: true, trackingStatus: true } });
    check("Fahrt hat einen neuen Fahrer", dbNew?.driverId === d2.driverId, { ist: dbNew?.driverId, erwartet: d2.driverId });

    const newSms = await smsFor(bid, "NEW_DRIVER");
    check("Kunde erhaelt 'neuer Fahrer gefunden'-SMS", newSms.length === 1, newSms.map((s) => s.status));
    if (newSms[0]) info(`SMS an ${newSms[0].to}: "${newSms[0].body}"`);
  }

  // ---------------------------------------------------------------
  section("7) SMS-Bilanz: keine Doppel-SMS");
  const all = await smsFor(bid);
  info(`Insgesamt ${all.length} SMS zu dieser Fahrt:`);
  for (const m of all) info(`   [${m.kind}] ${m.status} -> ${m.to}`);
  const keys = all.map((m) => m.dedupeKey);
  check("Alle dedupeKeys eindeutig (keine Doppel-SMS)", new Set(keys).size === keys.length, keys);
  check("Kunden-Telefonnummern durchgehend E.164", all.every((m) => /^\+\d{8,15}$/.test(m.to)), all.map((m) => m.to));

  // Erneuter Storno-Versuch derselben (jetzt fremden) Fahrt muss scheitern.
  const again = await emitAck(s1, "driver:cancelScheduled", { bookingId: bid });
  check("Alter Fahrer kann die neu vergebene Fahrt nicht stornieren", again?.ok === false, again);

  s1.close();
  s2.close();
  await prisma.$disconnect();
  finish("DRIVER-CONFIRM-REPLACE");
}
main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
