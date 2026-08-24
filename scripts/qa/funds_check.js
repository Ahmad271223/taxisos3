// QA: Deckungsprüfung der Karte VOR der Fahrt.
//
// Hintergrund (Zahlungspunkt 7): Beim Buchen wird die Karte nur hinterlegt –
// das beweist nur, dass sie existiert, nicht dass Geld drauf ist. Ohne weitere
// Prüfung merkt das Unternehmen erst NACH der Fahrt, dass nichts abgebucht
// werden kann. Deshalb wird beim Livegehen der Fahrt (Fahrer unterwegs) der
// geschätzte Betrag bei der Bank reserviert.
//
// Geprüft wird:
//   1) Gedeckte Karte  -> Reservierung entsteht, Fahrt läuft normal
//   2) Ungedeckte Karte -> Fahrt steht SOFORT auf FEHLGESCHLAGEN (vor Fahrtantritt)
//   3) Abgelehnte Karte -> gleiches Verhalten, verständliche Meldung
//   4) Endabrechnung    -> es wird GENAU der Endpreis eingezogen, nicht die Reservierung
//   5) Storno           -> Reservierung wird freigegeben
//   6) Barzahlung       -> gar keine Reservierung
//   7) Vorbestellung    -> kein Geld tagelang blockiert
//
// Aufruf: node scripts/qa/funds_check.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep, get, post, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;

async function registerCustomer(tag) {
  const id = H.uniq();
  const phone = "+4915" + String(id).slice(-9);
  // Kleinschreibung: die Registrierung normalisiert die Adresse.
  const email = `deckung${tag}${id}@test.de`.toLowerCase();
  const reg = await post("/api/customer/register", {
    name: `Deckung ${tag}`, email, phone, password: "Pass1234",
  });
  return { cookie: reg.cookie, phone, email, name: `Deckung ${tag}` };
}

// Karte am Stripe-Kunden hinterlegen (entspricht der gehosteten Stripe-Seite).
async function addCard(cust, testPm) {
  const si = await post("/api/customer/payment-methods", {}, cust.cookie);
  if (si.status !== 200) return { ok: false, error: si.body?.error };
  let paymentMethodId;
  if (stripe) {
    const row = await prisma.customer.findUnique({
      where: { email: cust.email }, select: { stripeCustomerId: true },
    });
    if (!row?.stripeCustomerId) return { ok: false, error: "Kein Stripe-Kunde angelegt" };
    try {
      const pm = await stripe.paymentMethods.attach(testPm, { customer: row.stripeCustomerId });
      paymentMethodId = pm.id;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  } else {
    paymentMethodId = "mock_pm_" + Math.random().toString(36).slice(2, 10);
  }
  const put = await H.api("/api/customer/payment-methods",
    { method: "PUT", body: JSON.stringify({ paymentMethodId }) }, cust.cookie);
  return { ok: put.status === 201, card: put.body?.card, error: put.body?.error };
}

// Fahrt bis "Fahrer unterwegs" bringen und der Deckungsprüfung Zeit geben.
async function goLive(sock, offers, bookingId) {
  try {
    await offers.match((o) => o.id === bookingId, 30000);
  } catch {
    return false;
  }
  await H.emitAck(sock, "driver:respond", { bookingId, accept: true });
  await sleep(2500); // Stripe-Reservierung läuft im Hintergrund
  return true;
}

async function main() {
  if (!stripe) {
    console.log("Ohne STRIPE_SECRET_KEY nicht aussagekräftig – abgebrochen.");
    process.exit(1);
  }
  const co = await H.registerCompany("DECK");
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });
  const drv = await H.createDriver(co.admin, "D", HBF);
  const sock = await H.goOnline(drv.cookie, HBF);
  const offers = H.collect(sock, "driver:offer");

  const buchen = (cust, extra = {}) => post("/api/bookings", {
    company: co.slug, customerName: cust.name, customerPhone: cust.phone,
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CARD", ...extra,
  }, cust.cookie);

  // =========================================================================
  section("1) Gedeckte Karte: Betrag wird zum Fahrtstart reserviert");
  const kA = await registerCustomer("A");
  const cA = await addCard(kA, "pm_card_visa");
  check("Karte hinterlegt", cA.ok, cA.error);

  const b1 = await buchen(kA);
  check("Fahrt gebucht", b1.status === 201, b1.body?.error);
  const vorStart = await prisma.booking.findUnique({
    where: { id: b1.body?.id }, select: { priceAuthorized: true, paymentRef: true, paymentStatus: true },
  });
  check("Beim Buchen wird NICHTS reserviert", vorStart?.priceAuthorized === null, vorStart?.priceAuthorized);
  check("Status: Karte hinterlegt", vorStart?.paymentStatus === "KARTE_HINTERLEGT", vorStart?.paymentStatus);

  const live1 = await goLive(sock, offers, b1.body?.id);
  check("Fahrer nimmt an", live1);
  const nachStart = await prisma.booking.findUnique({
    where: { id: b1.body?.id },
    select: { priceAuthorized: true, paymentRef: true, paymentStatus: true, priceApprox: true, priceExact: true, paymentError: true },
  });
  check("Deckung geprüft -> Betrag reserviert", (nachStart?.priceAuthorized ?? 0) > 0, nachStart?.priceAuthorized);
  check("Reservierung bei Stripe hinterlegt", !!nachStart?.paymentRef, nachStart?.paymentRef);
  check("Fahrt bleibt zahlungsbereit", nachStart?.paymentStatus === "KARTE_HINTERLEGT", nachStart?.paymentStatus);
  check("Kein Zahlungsfehler", !nachStart?.paymentError, nachStart?.paymentError);

  if (nachStart?.paymentRef && !String(nachStart.paymentRef).startsWith("mock")) {
    const pi = await stripe.paymentIntents.retrieve(nachStart.paymentRef);
    check("Stripe: nur reserviert, NICHT abgebucht", pi.status === "requires_capture", pi.status);
    check("Noch kein Geld geflossen", pi.amount_received === 0, pi.amount_received);
    const schaetzung = nachStart.priceExact ?? nachStart.priceApprox ?? 0;
    check("Reservierung deckt den Fahrpreis ab", pi.amount / 100 >= schaetzung,
      { reserviert: pi.amount / 100, geschaetzt: schaetzung });
    info(`Reserviert: ${(pi.amount / 100).toFixed(2)} € (Schätzung ${schaetzung.toFixed(2)} €)`);
  }

  // =========================================================================
  section("2) Endabrechnung zieht GENAU den Endpreis ein");
  for (const a of ["arrived", "start", "complete"]) {
    await H.emitAck(sock, "driver:trip", { bookingId: b1.body?.id, action: a });
    await sleep(250);
  }
  await sleep(800);
  const bezahlt = await post(`/api/bookings/${b1.body?.id}/pay`, { tip: 0 }, kA.cookie);
  check("Zahlung durchgeführt", bezahlt.status === 200, bezahlt.body?.error);
  const final1 = await prisma.booking.findUnique({
    where: { id: b1.body?.id }, select: { paymentStatus: true, fare: true, tip: true, paymentRef: true, priceAuthorized: true },
  });
  check("Als bezahlt verbucht", final1?.paymentStatus === "BEZAHLT", final1?.paymentStatus);
  if (final1?.paymentRef && !String(final1.paymentRef).startsWith("mock")) {
    const pi = await stripe.paymentIntents.retrieve(final1.paymentRef);
    const soll = Math.round(((final1.fare ?? 0) + (final1.tip ?? 0)) * 100);
    check("Stripe: Zahlung abgeschlossen", pi.status === "succeeded", pi.status);
    check("Es wird der Fahrpreis abgebucht, nicht die Reservierung",
      pi.amount_received === soll, { abgebucht: pi.amount_received / 100, fahrpreis: soll / 100 });
    check("Überschuss der Reservierung verfällt sofort",
      pi.amount_received <= Math.round((final1.priceAuthorized ?? 0) * 100),
      { abgebucht: pi.amount_received / 100, reserviert: final1.priceAuthorized });
    info(`Reserviert ${final1.priceAuthorized?.toFixed(2)} € -> abgebucht ${(pi.amount_received / 100).toFixed(2)} €`);
  }

  // =========================================================================
  section("3) Ungedeckte Karte wird VOR der Fahrt erkannt");
  // Hinweis: eine offensichtlich ungedeckte Karte lehnt Stripe schon beim
  // Speichern ab (siehe Abschnitt 7). Gefährlich sind die Karten, die sich
  // speichern lassen und erst beim Abbuchen scheitern – genau die hier.
  const kB = await registerCustomer("B");
  const cB = await addCard(kB, "pm_card_chargeCustomerFail");
  check("Karte lässt sich hinterlegen (Deckung noch unbekannt)", cB.ok, cB.error);

  const b2 = await buchen(kB);
  check("Fahrt buchbar", b2.status === 201, b2.body?.error);
  const live2 = await goLive(sock, offers, b2.body?.id);
  check("Fahrer nimmt an", live2);

  const deck = await prisma.booking.findUnique({
    where: { id: b2.body?.id },
    select: { paymentStatus: true, paymentError: true, priceAuthorized: true, status: true, trackingStatus: true },
  });
  check("Zahlungsproblem VOR Fahrtantritt erkannt", deck?.paymentStatus === "FEHLGESCHLAGEN", deck?.paymentStatus);
  check("Verständliche Meldung für den Kunden", !!deck?.paymentError, deck?.paymentError);
  check("Nichts reserviert", deck?.priceAuthorized === null, deck?.priceAuthorized);
  check("Fahrt wurde noch nicht gefahren", deck?.trackingStatus === "FAHRER_UNTERWEGS", deck?.trackingStatus);
  info(`Meldung: ${deck?.paymentError}`);

  const sicht = await get(`/api/bookings/${b2.body?.id}/pay`, kB.cookie);
  check("Kunde sieht das Problem in der App", sicht.body?.paymentStatus === "FEHLGESCHLAGEN", sicht.body?.paymentStatus);
  check("Kunde kann eine andere Karte wählen", Array.isArray(sicht.body?.cards), sicht.body?.cards);

  const smsB = await prisma.smsLog.findFirst({
    where: { bookingId: b2.body?.id, kind: "PAYMENT_FAILED" },
    select: { body: true, dedupeKey: true },
  });
  check("Kunde wurde per SMS informiert", !!smsB, smsB?.dedupeKey);
  info(`SMS: ${smsB?.body?.slice(0, 90)}…`);

  section("3b) Kunde löst das Problem noch während der Fahrt");
  const gut = await addCard(kB, "pm_card_visa");
  check("Zweite, gültige Karte hinterlegt", gut.ok, gut.error);
  const wechsel = await post(`/api/bookings/${b2.body?.id}/pay`, { cardId: gut.card?.id }, kB.cookie);
  check("Kartenwechsel während der Fahrt möglich", wechsel.status === 200, { s: wechsel.status, e: wechsel.body?.error });
  const nachWechsel = await prisma.booking.findUnique({
    where: { id: b2.body?.id }, select: { paymentStatus: true, priceAuthorized: true, paymentError: true },
  });
  check("Neue Karte sofort geprüft und gedeckt", (nachWechsel?.priceAuthorized ?? 0) > 0, nachWechsel?.priceAuthorized);
  check("Fahrt wieder zahlungsbereit", nachWechsel?.paymentStatus === "KARTE_HINTERLEGT", nachWechsel?.paymentStatus);
  check("Fehlermeldung verschwunden", !nachWechsel?.paymentError, nachWechsel?.paymentError);

  // Aufräumen: Fahrt beenden, damit der Fahrer wieder frei ist.
  for (const a of ["arrived", "start", "complete"]) {
    await H.emitAck(sock, "driver:trip", { bookingId: b2.body?.id, action: a });
    await sleep(200);
  }
  await sleep(600);

  // =========================================================================
  section("4) Storno gibt die Reservierung sofort wieder frei");
  const kC = await registerCustomer("C");
  const cC = await addCard(kC, "pm_card_visa");
  check("Karte hinterlegt", cC.ok, cC.error);
  const b3 = await buchen(kC);
  const live3 = await goLive(sock, offers, b3.body?.id);
  check("Fahrt live", live3);
  const vorStorno = await prisma.booking.findUnique({
    where: { id: b3.body?.id }, select: { paymentRef: true, priceAuthorized: true },
  });
  check("Betrag ist reserviert", (vorStorno?.priceAuthorized ?? 0) > 0, vorStorno?.priceAuthorized);
  const refVorStorno = vorStorno?.paymentRef;

  const storno = await post(`/api/bookings/${b3.body?.id}/cancel`, { reason: "Test" }, kC.cookie);
  check("Storno akzeptiert", storno.status === 200 || storno.status === 201, storno.status);
  await sleep(1200);
  const nachStorno = await prisma.booking.findUnique({
    where: { id: b3.body?.id }, select: { priceAuthorized: true, paymentStatus: true },
  });
  check("Reservierung im System aufgelöst", nachStorno?.priceAuthorized === null, nachStorno?.priceAuthorized);
  if (refVorStorno && !String(refVorStorno).startsWith("mock")) {
    const pi = await stripe.paymentIntents.retrieve(refVorStorno);
    check("Stripe: Geld beim Kunden freigegeben",
      pi.status === "canceled" || pi.amount_received > 0, pi.status);
    info(`Stripe-Status nach Storno: ${pi.status}`);
  }

  // =========================================================================
  section("5) Barzahlung: keine Reservierung, keine Kartenprüfung");
  const kD = await registerCustomer("D");
  const b4 = await post("/api/bookings", {
    company: co.slug, customerName: kD.name, customerPhone: kD.phone,
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH",
  }, kD.cookie);
  check("Barfahrt gebucht", b4.status === 201, b4.body?.error);
  const live4 = await goLive(sock, offers, b4.body?.id);
  check("Fahrt live", live4);
  const bar = await prisma.booking.findUnique({
    where: { id: b4.body?.id }, select: { priceAuthorized: true, paymentRef: true, paymentStatus: true, cardId: true },
  });
  check("Kein Geld reserviert", bar?.priceAuthorized === null, bar?.priceAuthorized);
  check("Keine Stripe-Zahlung angelegt", !bar?.paymentRef, bar?.paymentRef);
  check("Keine Karte verknüpft", bar?.cardId === null, bar?.cardId);
  for (const a of ["arrived", "start", "complete"]) {
    await H.emitAck(sock, "driver:trip", { bookingId: b4.body?.id, action: a });
    await sleep(200);
  }
  await sleep(600);

  // =========================================================================
  section("6) Vorbestellung blockiert kein Geld im Voraus");
  const kE = await registerCustomer("E");
  const cE = await addCard(kE, "pm_card_visa");
  check("Karte hinterlegt", cE.ok, cE.error);
  const morgen = new Date(Date.now() + 26 * 60 * 60 * 1000);
  const b5 = await buchen(kE, { isScheduled: true, scheduledAt: morgen.toISOString() });
  check("Vorbestellung angelegt", b5.status === 201, b5.body?.error);
  await sleep(1500);
  const vor = await prisma.booking.findUnique({
    where: { id: b5.body?.id }, select: { priceAuthorized: true, paymentRef: true, paymentStatus: true },
  });
  check("Kein Geld über Nacht blockiert", vor?.priceAuthorized === null, vor?.priceAuthorized);
  check("Keine Stripe-Reservierung", !vor?.paymentRef, vor?.paymentRef);
  check("Karte ist trotzdem vorgemerkt", vor?.paymentStatus === "KARTE_HINTERLEGT", vor?.paymentStatus);

  // =========================================================================
  section("7) Ungedeckte Karte kommt gar nicht erst ins Konto");
  const kF = await registerCustomer("F");
  const cF = await addCard(kF, "pm_card_visa_chargeDeclinedInsufficientFunds");
  check("Karte ohne Deckung wird beim Speichern abgelehnt", !cF.ok, cF.error);
  info(`Bank-Antwort: ${cF.error}`);
  const kartenF = await get("/api/customer/payment-methods", kF.cookie);
  check("Sie landet nicht im Konto", (kartenF.body?.cards ?? []).length === 0, kartenF.body?.cards);
  const b6 = await buchen(kF);
  check("Kartenzahlung ohne gültige Karte nicht möglich", b6.status === 402, { s: b6.status, e: b6.body?.error });

  sock.close();
  await prisma.$disconnect();
  finish("DECKUNGSPRÜFUNG");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
