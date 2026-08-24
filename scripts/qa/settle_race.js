// QA: Zwei Fehler, die beim Einbau der Deckungsprüfung aufgefallen sind.
//
// A) Doppelte Abbuchung
//    Kunde und automatische Abrechnung können gleichzeitig starten. Der alte
//    Schutz zählte nur Versuche mit – während der rund einen Sekunde, die
//    Stripe braucht, stand die Fahrt aber weiter auf "Karte hinterlegt". Der
//    zweite Lauf kam durch, buchte erneut ab und markierte die BEREITS
//    BEZAHLTE Fahrt als "Zahlung offen".
//
// B) Wiederbelebte Zahlung nach Storno
//    Storniert der Fahrer, während die Reservierung noch bei Stripe läuft,
//    schrieb deren Antwort danach den Zahlungsstatus zurück auf die stornierte
//    Fahrt – das Geld des Kunden blieb blockiert.
//
// Aufruf: node scripts/qa/settle_race.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep, post, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;

async function registerCustomer(tag) {
  const id = H.uniq();
  const phone = "+4915" + String(id).slice(-9);
  const email = `race${tag}${id}@test.de`.toLowerCase();
  const reg = await post("/api/customer/register", { name: `Race ${tag}`, email, phone, password: "Pass1234" });
  return { cookie: reg.cookie, phone, email, name: `Race ${tag}` };
}

async function addCard(cust) {
  await post("/api/customer/payment-methods", {}, cust.cookie);
  const row = await prisma.customer.findUnique({ where: { email: cust.email }, select: { stripeCustomerId: true } });
  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: row.stripeCustomerId });
  const put = await H.api("/api/customer/payment-methods",
    { method: "PUT", body: JSON.stringify({ paymentMethodId: pm.id }) }, cust.cookie);
  return put.status === 201;
}

async function main() {
  if (!stripe) { console.log("Ohne STRIPE_SECRET_KEY nicht aussagekräftig."); process.exit(1); }
  const co = await H.registerCompany("RACE");
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });
  const drv = await H.createDriver(co.admin, "R", HBF);
  const sock = await H.goOnline(drv.cookie, HBF);
  const offers = H.collect(sock, "driver:offer");

  const buchen = (cust) => post("/api/bookings", {
    company: co.slug, customerName: cust.name, customerPhone: cust.phone,
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CARD",
  }, cust.cookie);

  // =========================================================================
  section("A) Gleichzeitige Zahlungsversuche buchen nur EINMAL ab");
  const kA = await registerCustomer("A");
  check("Karte hinterlegt", await addCard(kA));
  const b1 = await buchen(kA);
  await offers.match((o) => o.id === b1.body?.id, 30000);
  await H.emitAck(sock, "driver:respond", { bookingId: b1.body?.id, accept: true });
  await sleep(2500);
  for (const a of ["arrived", "start", "complete"]) {
    await H.emitAck(sock, "driver:trip", { bookingId: b1.body?.id, action: a });
    await sleep(250);
  }
  await sleep(800);

  // Fünf Zahlungen exakt gleichzeitig – so wie Kunde, Wiederholung und
  // automatische Abrechnung im Betrieb zusammentreffen können.
  const gleichzeitig = await Promise.all(
    Array.from({ length: 5 }, () => post(`/api/bookings/${b1.body?.id}/pay`, { tip: 0 }, kA.cookie)),
  );
  const erfolge = gleichzeitig.filter((r) => r.status === 200).length;
  info(`Antworten: ${gleichzeitig.map((r) => r.status).join(", ")}`);
  check("Genau eine Zahlung geht durch", erfolge === 1, erfolge);

  const nach = await prisma.booking.findUnique({
    where: { id: b1.body?.id },
    select: { paymentStatus: true, paymentRef: true, fare: true, tip: true, settlingAt: true, paymentAttempts: true },
  });
  check("Fahrt gilt als BEZAHLT", nach?.paymentStatus === "BEZAHLT", nach?.paymentStatus);
  check("Keine Fehlanzeige trotz Parallelität", nach?.paymentStatus !== "FEHLGESCHLAGEN", nach?.paymentStatus);
  check("Sperre wieder freigegeben", nach?.settlingAt === null, nach?.settlingAt);

  // Der harte Beweis: bei Stripe darf genau einmal Geld geflossen sein.
  const kunde = await prisma.customer.findUnique({ where: { email: kA.email }, select: { stripeCustomerId: true } });
  const alle = await stripe.paymentIntents.list({ customer: kunde.stripeCustomerId, limit: 20 });
  const fuerFahrt = alle.data.filter((p) => p.metadata?.bookingId === b1.body?.id);
  const bezahlt = fuerFahrt.filter((p) => (p.amount_received ?? 0) > 0);
  const summe = bezahlt.reduce((s, p) => s + p.amount_received, 0) / 100;
  const soll = Math.round(((nach?.fare ?? 0) + (nach?.tip ?? 0)) * 100) / 100;
  info(`Stripe-Vorgänge für diese Fahrt: ${fuerFahrt.length}, davon belastet: ${bezahlt.length}`);
  check("Der Kunde wurde nur EINMAL belastet", bezahlt.length === 1, bezahlt.map((p) => p.id));
  check("Und zwar genau der Fahrpreis", Math.abs(summe - soll) < 0.01, { belastet: summe, fahrpreis: soll });

  // =========================================================================
  section("B) Storno während der Kartenprüfung lässt kein Geld blockiert");
  const kB = await registerCustomer("B");
  check("Karte hinterlegt", await addCard(kB));
  const b2 = await buchen(kB);
  await offers.match((o) => o.id === b2.body?.id, 30000);
  // Annehmen und SOFORT stornieren – mitten in die laufende Stripe-Anfrage.
  await H.emitAck(sock, "driver:respond", { bookingId: b2.body?.id, accept: true });
  await sleep(300);
  await H.emitAck(sock, "driver:trip", { bookingId: b2.body?.id, action: "cancel" });
  // Der Reservierung Zeit geben, zurückzukommen und Schaden anzurichten.
  await sleep(4000);

  const st = await prisma.booking.findUnique({
    where: { id: b2.body?.id },
    select: { status: true, paymentStatus: true, priceAuthorized: true, paymentRef: true },
  });
  check("Fahrt ist storniert", st?.status === "STORNIERT", st?.status);
  check("Zahlungsstatus bleibt storniert", st?.paymentStatus === "STORNIERT", st?.paymentStatus);
  check("Keine Reservierung mehr eingetragen", st?.priceAuthorized === null, st?.priceAuthorized);
  check("Nichts abgebucht", st?.paymentStatus !== "BEZAHLT", st?.paymentStatus);

  // Entscheidend: liegt bei Stripe noch Geld des Kunden fest?
  const kundeB = await prisma.customer.findUnique({ where: { email: kB.email }, select: { stripeCustomerId: true } });
  const alleB = await stripe.paymentIntents.list({ customer: kundeB.stripeCustomerId, limit: 20 });
  const offen = alleB.data.filter((p) => p.status === "requires_capture");
  info(`Offene Reservierungen bei Stripe: ${offen.length}`);
  check("Kein Betrag bleibt auf der Karte blockiert", offen.length === 0,
    offen.map((p) => `${p.id}: ${p.amount / 100} €`));

  // =========================================================================
  section("C) Storno vor der Fahrt kostet nichts");
  const kC = await registerCustomer("C");
  check("Karte hinterlegt", await addCard(kC));
  const b3 = await buchen(kC);
  await offers.match((o) => o.id === b3.body?.id, 30000);
  await H.emitAck(sock, "driver:respond", { bookingId: b3.body?.id, accept: true });
  await sleep(3000); // Reservierung diesmal in Ruhe abschließen lassen
  const vorC = await prisma.booking.findUnique({
    where: { id: b3.body?.id }, select: { priceAuthorized: true },
  });
  check("Betrag ist reserviert", (vorC?.priceAuthorized ?? 0) > 0, vorC?.priceAuthorized);
  await H.emitAck(sock, "driver:trip", { bookingId: b3.body?.id, action: "cancel" });
  await sleep(2000);
  const nachC = await prisma.booking.findUnique({
    where: { id: b3.body?.id }, select: { status: true, paymentStatus: true, priceAuthorized: true },
  });
  check("Fahrt storniert", nachC?.status === "STORNIERT", nachC?.status);
  check("Reservierung aufgelöst", nachC?.priceAuthorized === null, nachC?.priceAuthorized);
  const alleC = await stripe.paymentIntents.list({
    customer: (await prisma.customer.findUnique({ where: { email: kC.email }, select: { stripeCustomerId: true } })).stripeCustomerId,
    limit: 20,
  });
  check("Geld wieder frei", alleC.data.filter((p) => p.status === "requires_capture").length === 0);
  check("Nichts belastet", alleC.data.every((p) => (p.amount_received ?? 0) === 0));

  sock.close();
  await prisma.$disconnect();
  finish("ZAHLUNGS-WETTLAUF");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
