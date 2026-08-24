// QA: Fahrersuche endet nach 3 Minuten -> Abbruch, SMS mit Zentralen-Nummer,
// Kunde kann neu anfragen. Suche darf danach NICHT von selbst weiterlaufen.
//
// Schnelllauf: Server mit kurzem Fenster starten, z. B.
//   PORT=3010 ENABLE_SIMULATOR=0 SEARCH_MAX_MS=6000 npx tsx server.ts
//   node scripts/qa/no_driver_hotline.js http://127.0.0.1:3010
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep, emitAck, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const HOTLINE = (process.env.NEXT_PUBLIC_PLATFORM_PHONE ?? "").trim();
const SEARCH_MAX_MS = Number(process.env.SEARCH_MAX_MS ?? 180_000);

async function main() {
  section("Konfiguration");
  info(`Suchdauer: ${SEARCH_MAX_MS / 1000} s`);
  info(`Zentrale: ${HOTLINE || "(nicht gesetzt)"}`);
  check("Zentralen-Nummer ist hinterlegt", !!HOTLINE, HOTLINE);
  check("Suchdauer betraegt 3 Minuten (bzw. Testwert)", SEARCH_MAX_MS === 180_000 || SEARCH_MAX_MS < 180_000, SEARCH_MAX_MS);

  section("1) Buchung ohne verfuegbaren Fahrer");
  const co = await H.registerCompany("NODRV");
  // Fahrer anlegen, aber NICHT frei schalten -> kein Kandidat.
  const drv = await H.createDriver(co.admin, "ND", HBF);
  const bk = await H.book(co.slug, { customerName: "Ohne Fahrer", pickup: HBF, dest: LIST });
  check("Buchung angelegt", bk.status === 201, bk.status);
  const bid = bk.body?.id;
  const phone = bk.body?.booking?.customerPhone;

  section(`2) Warten bis die Suche endet (max. ${Math.ceil(SEARCH_MAX_MS / 1000) + 40} s)`);
  let st = null;
  const deadline = Date.now() + SEARCH_MAX_MS + 40_000;
  while (Date.now() < deadline) {
    await sleep(3000);
    st = await prisma.booking.findUnique({ where: { id: bid }, select: { trackingStatus: true, status: true, driverId: true } });
    if (st?.trackingStatus === "KEIN_FAHRER") break;
  }
  info(`Endstatus: ${st?.trackingStatus}`);
  check("Suche endet mit 'Kein Fahrer gefunden'", st?.trackingStatus === "KEIN_FAHRER", st?.trackingStatus);
  check("Kein Fahrer zugewiesen", !st?.driverId, st?.driverId);

  section("3) SMS an den Kunden mit der Zentralen-Nummer");
  const sms = await prisma.smsLog.findMany({ where: { bookingId: bid, kind: "NO_DRIVER" } });
  check("Genau EINE Abbruch-SMS", sms.length === 1, sms.length);
  if (sms[0]) {
    info(`SMS an ${sms[0].to}: "${sms[0].body}"`);
    check("SMS nennt die Zentralen-Nummer", sms[0].body.includes(HOTLINE), sms[0].body);
    check("SMS erwaehnt eine neue Anfrage", /neue Anfrage/i.test(sms[0].body), sms[0].body);
    check("Empfaengernummer in E.164", /^\+\d{8,15}$/.test(sms[0].to), sms[0].to);
  }

  section("4) Suche laeuft NICHT von selbst weiter");
  // Fahrer jetzt frei schalten -> die abgelaufene Fahrt darf er nicht bekommen.
  const s = await H.goOnline(drv.cookie, HBF);
  await sleep(25000); // laenger als das Sweep-Intervall (20 s)
  const after = await prisma.booking.findUnique({ where: { id: bid }, select: { trackingStatus: true, driverId: true } });
  check("Status bleibt 'Kein Fahrer gefunden'", after?.trackingStatus === "KEIN_FAHRER", after?.trackingStatus);
  check("Auch ein jetzt freier Fahrer bekommt die Fahrt nicht", !after?.driverId, after?.driverId);
  const sms2 = await prisma.smsLog.count({ where: { bookingId: bid, kind: "NO_DRIVER" } });
  check("Keine zweite Abbruch-SMS", sms2 === 1, sms2);

  section("5) Kunde stellt eine NEUE Anfrage -> funktioniert sofort");
  const offers = H.collect(s, "driver:offer");
  const again = await H.book(co.slug, {
    customerName: "Ohne Fahrer",
    customerPhone: phone,
    pickup: HBF,
    dest: LIST,
  });
  check("Neue Anfrage angelegt", again.status === 201, again.status);
  const nid = again.body?.id;
  let gotOffer = true;
  try {
    await offers.match((o) => o.id === nid, 30000);
  } catch {
    gotOffer = false;
  }
  check("Der jetzt freie Fahrer erhaelt die neue Anfrage", gotOffer);
  if (gotOffer) {
    const acc = await emitAck(s, "driver:respond", { bookingId: nid, accept: true });
    check("Fahrer nimmt die neue Anfrage an", acc?.ok === true, acc);
    await sleep(1000);
    const r = await prisma.booking.findUnique({ where: { id: nid }, select: { driverId: true, trackingStatus: true } });
    info(`Neue Fahrt vermittelt: ${r?.trackingStatus}`);
    check("Neue Fahrt hat einen Fahrer", !!r?.driverId, r?.driverId);
  }

  s.close();
  await prisma.$disconnect();
  finish("NO-DRIVER-HOTLINE");
}
main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
