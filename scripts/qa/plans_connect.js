// QA: Abo-Tarife + Fahrer-Kontingent + Provision = 0 + Stripe Connect.
// Aufruf: node scripts/qa/plans_connect.js
/* eslint-disable no-console */
const H = require("./helpers");
const { check, info, section, finish, sleep, get, post, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PLAN_MATRIX = [
  { id: "P5", drivers: 5, price: 100 },
  { id: "P10", drivers: 10, price: 190 },
  { id: "P15", drivers: 15, price: 235 },
  { id: "P20", drivers: 20, price: 260 },
];

async function addDriver(adminCookie, i) {
  const u = `plandrv${Date.now()}${i}${Math.floor(Math.random() * 1000)}`;
  return post("/api/admin/drivers", { name: `Fahrer ${i}`, username: u, password: "Pass1234" }, adminCookie);
}

async function main() {
  section("1) Tarif-Definitionen");

  const co = await H.registerCompany("PLAN");
  check("Firma registriert", co.status === 201 || co.status === 200, co.status);
  const companyRow = await prisma.company.findUnique({ where: { slug: co.slug }, select: { plan: true, subscriptionStatus: true } });
  check("Neue Firma startet im Tarif P5", companyRow?.plan === "P5", companyRow?.plan);
  info(`Abo-Status: ${companyRow?.subscriptionStatus}`);

  const info0 = await get("/api/admin/drivers", co.admin);
  check("GET /api/admin/drivers liefert Tarif-Infos", !!info0.body?.plan, info0.body?.plan);
  check("Tarif P5 = 5 Fahrer / 100 €", info0.body?.plan?.maxDrivers === 5 && info0.body?.plan?.monthlyPrice === 100, info0.body?.plan);
  check("canAddDriver anfangs true", info0.body?.canAddDriver === true, info0.body?.canAddDriver);

  // ---------------------------------------------------------------
  section("2) Fahrer-Kontingent P5: 5 erlaubt, der 6. wird abgelehnt");
  for (let i = 1; i <= 5; i++) {
    const r = await addDriver(co.admin, i);
    check(`Fahrer ${i}/5 anlegbar`, r.status === 201, { status: r.status, err: r.body?.error });
  }
  const sixth = await addDriver(co.admin, 6);
  check("6. Fahrer abgelehnt (402 PLAN_LIMIT_REACHED)", sixth.status === 402 && sixth.body?.code === "PLAN_LIMIT_REACHED", {
    status: sixth.status,
    code: sixth.body?.code,
  });
  info(`Fehlermeldung: ${sixth.body?.error}`);
  check("Upgrade-Vorschlag = P10", sixth.body?.suggestion?.id === "P10", sixth.body?.suggestion);
  const count5 = await prisma.driver.count({ where: { company: { slug: co.slug } } });
  check("Es wurden wirklich nur 5 Fahrer angelegt", count5 === 5, count5);

  const infoFull = await get("/api/admin/drivers", co.admin);
  check("canAddDriver jetzt false", infoFull.body?.canAddDriver === false, infoFull.body?.canAddDriver);

  // ---------------------------------------------------------------
  section("3) Upgrade auf P10 -> 6. Fahrer wird moeglich");
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P10", subscriptionStatus: "AKTIV" } });
  const sixthAgain = await addDriver(co.admin, 6);
  check("Nach Upgrade ist der 6. Fahrer anlegbar", sixthAgain.status === 201, { status: sixthAgain.status, err: sixthAgain.body?.error });
  const infoP10 = await get("/api/admin/drivers", co.admin);
  check("Tarif P10 = 10 Fahrer / 190 €", infoP10.body?.plan?.maxDrivers === 10 && infoP10.body?.plan?.monthlyPrice === 190, infoP10.body?.plan);

  // ---------------------------------------------------------------
  section("4) Alle vier Tarifstufen korrekt hinterlegt");
  for (const p of PLAN_MATRIX) {
    await prisma.company.update({ where: { slug: co.slug }, data: { plan: p.id } });
    const r = await get("/api/admin/drivers", co.admin);
    check(
      `${p.id}: ${p.drivers} Fahrer / ${p.price} € pro Monat`,
      r.body?.plan?.maxDrivers === p.drivers && r.body?.plan?.monthlyPrice === p.price,
      r.body?.plan,
    );
  }
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P10" } });

  // ---------------------------------------------------------------
  section("5) KEINE Provision pro Fahrt");
  const drv = await H.createDriver(co.admin, "PZ", HBF);
  const s = await H.goOnline(drv.cookie, HBF);
  const offers = H.collect(s, "driver:offer");
  const bk = await H.book(co.slug, { customerName: "Provision Test", pickup: HBF, dest: LIST });
  check("Fahrt gebucht", bk.status === 201, bk.status);
  const bid = bk.body?.id;
  await offers.match((o) => o.id === bid, 25000);
  await H.emitAck(s, "driver:respond", { bookingId: bid, accept: true });
  await sleep(300);
  for (const a of ["arrived", "start", "complete"]) {
    await H.emitAck(s, "driver:trip", { bookingId: bid, action: a });
    await sleep(200);
  }
  await sleep(800);
  const done = await prisma.booking.findUnique({
    where: { id: bid },
    select: { fare: true, platformFee: true, platformFeeRate: true, companyNet: true },
  });
  info(`Fahrpreis ${done?.fare} € | platformFee ${done?.platformFee} € | rate ${done?.platformFeeRate} | companyNet ${done?.companyNet} €`);
  check("platformFee = 0", done?.platformFee === 0, done?.platformFee);
  check("platformFeeRate = 0", done?.platformFeeRate === 0, done?.platformFeeRate);
  check("companyNet = voller Fahrpreis", Math.abs((done?.companyNet ?? -1) - (done?.fare ?? 0)) < 0.005, {
    companyNet: done?.companyNet,
    fare: done?.fare,
  });
  s.close();

  // ---------------------------------------------------------------
  section("6) Stripe Connect: Onboarding + Status");
  const st0 = await get("/api/admin/connect", co.admin);
  check("Connect-Status abrufbar", st0.status === 200, st0.status);
  check("Provision wird als 0 % ausgewiesen", st0.body?.commissionPercent === 0, st0.body?.commissionPercent);
  check("Abo-Infos enthalten", st0.body?.subscription?.plan === "P10" && st0.body?.subscription?.monthlyPrice === 190, st0.body?.subscription);
  check("Noch kein Konto verbunden", !st0.body?.connect?.accountId, st0.body?.connect?.accountId);

  const onboard = await post("/api/admin/connect", {}, co.admin);
  check("Onboarding-Link erzeugt", onboard.status === 200 && !!onboard.body?.url, { status: onboard.status, err: onboard.body?.error });
  check("Konto-ID gespeichert (acct_…)", (onboard.body?.accountId ?? "").startsWith("acct_"), onboard.body?.accountId);
  info(`Onboarding-URL: ${(onboard.body?.url ?? "").slice(0, 60)}…`);

  const dbCo = await prisma.company.findUnique({ where: { slug: co.slug }, select: { stripeAccountId: true } });
  check("Konto-ID in der DB hinterlegt", dbCo?.stripeAccountId === onboard.body?.accountId, dbCo?.stripeAccountId);

  const st1 = await get("/api/admin/connect", co.admin);
  check("Status zeigt das verbundene Konto", st1.body?.connect?.accountId === onboard.body?.accountId, st1.body?.connect);
  info(`chargesEnabled=${st1.body?.connect?.chargesEnabled} payoutsEnabled=${st1.body?.connect?.payoutsEnabled} (neu = noch nicht verifiziert, normal)`);
  check(
    "Offene Onboarding-Anforderungen werden gemeldet",
    Array.isArray(st1.body?.connect?.requirementsDue),
    st1.body?.connect?.requirementsDue,
  );

  // Wiederholter Aufruf darf KEIN zweites Konto anlegen.
  const onboard2 = await post("/api/admin/connect", {}, co.admin);
  check("Zweiter Aufruf nutzt dasselbe Konto (kein Duplikat)", onboard2.body?.accountId === onboard.body?.accountId, {
    erst: onboard.body?.accountId,
    dann: onboard2.body?.accountId,
  });

  section("7) Connect-Konto ist fuer die Zahlung hinterlegt");
  // Der eigentliche Zahlungsweg (gespeicherte Karte -> Destination-Charge ->
  // Firmenkonto) wird vollstaendig in scripts/qa/payment_flow.js geprueft.
  // Hier wird nur die Verknuepfung Firma <-> Connect-Konto sichergestellt.
  const dbCo2 = await prisma.company.findUnique({
    where: { slug: co.slug },
    select: { stripeAccountId: true, stripeChargesEnabled: true },
  });
  check("Firma hat ein Connect-Konto", !!dbCo2?.stripeAccountId, dbCo2?.stripeAccountId);
  info(`Freischaltung: ${dbCo2?.stripeChargesEnabled ? "ja" : "noch nicht (Onboarding offen)"}`);
  check(
    "Zahlungsstatus der Firma wird gespiegelt",
    typeof dbCo2?.stripeChargesEnabled === "boolean",
    dbCo2?.stripeChargesEnabled,
  );

  await prisma.$disconnect();
  finish("PLANS-CONNECT");
}
main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
