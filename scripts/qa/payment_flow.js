// QA: Kompletter Buchungs- und Zahlungsablauf (Punkte 1-17).
//
// Deckt die 22 geforderten Testfaelle ab. Dokumentiert je Fall:
//   Ausgangssituation -> Aktion -> erwartetes Ergebnis -> tatsaechliches Ergebnis
//
// Schnelllauf mit kurzem Trinkgeld-Fenster:
//   PORT=3011 ENABLE_SIMULATOR=0 TIP_WINDOW_MS=8000 npx tsx server.ts
//   QA_BASE=http://127.0.0.1:3011 TIP_WINDOW_MS=8000 node scripts/qa/payment_flow.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep, get, post, patch, del, emitAck, collect, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;

const TIP_WINDOW_MS = Number(process.env.TIP_WINDOW_MS ?? 120_000);

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------
function caseHead(nr, title, ausgang, aktion, erwartet) {
  section(`FALL ${nr}: ${title}`);
  info(`Ausgangssituation: ${ausgang}`);
  info(`Aktion:            ${aktion}`);
  info(`Erwartet:          ${erwartet}`);
}

// Kundenkonto anlegen + einloggen (liefert Cookie).
async function registerCustomer(tag) {
  const id = H.uniq();
  const phone = "+4915" + String(id).slice(-9);
  const email = `kunde${tag}${id}@test.de`;
  // Telefon-Verifizierung ist im Testlauf abgeschaltet (REQUIRE_PHONE_VERIFICATION=0),
  // daher KEIN verify/request -> es werden keine echten SMS ausgeloest.
  const reg = await post("/api/customer/register", {
    name: `Kunde ${tag}`,
    email,
    phone,
    password: "Pass1234",
  });
  return { cookie: reg.cookie, email, phone, status: reg.status };
}

// Karte im Konto hinterlegen (SetupIntent + Bestaetigung wie im Browser).
async function addCard(cookie, testPm = "pm_card_visa") {
  const si = await post("/api/customer/payment-methods", {}, cookie);
  if (si.status !== 200) return { ok: false, status: si.status, error: si.body?.error };
  let paymentMethodId;
  if (stripe) {
    // Echte Zahlungsmethode am Stripe-Kunden hinterlegen. Der Kunde macht das
    // im Browser auf der gehosteten Stripe-Seite; per API entspricht das einem
    // attach an denselben Kunden.
    // Den zum Cookie gehoerenden Kunden ueber sein Profil bestimmen.
    const prof = await get("/api/customer/profile", cookie);
    const email = prof.body?.profile?.email ?? prof.body?.email;
    const cust = email
      ? await prisma.customer.findUnique({ where: { email }, select: { stripeCustomerId: true } })
      : null;
    const stripeCustomerId = cust?.stripeCustomerId;
    if (!stripeCustomerId) return { ok: false, error: "Kein Stripe-Kunde angelegt" };
    try {
      const pm = await stripe.paymentMethods.attach(testPm, { customer: stripeCustomerId });
      paymentMethodId = pm.id;
    } catch (e) {
      return { ok: false, error: `Karte konnte nicht hinterlegt werden: ${e.message}` };
    }
  } else {
    paymentMethodId = "mock_pm_" + Math.random().toString(36).slice(2, 10);
  }
  const put = await H.api(
    "/api/customer/payment-methods",
    { method: "PUT", body: JSON.stringify({ paymentMethodId }) },
    cookie,
  );
  return { ok: put.status === 201, card: put.body?.card, paymentMethodId, status: put.status, error: put.body?.error };
}

// Firma + verifiziertes Connect-Konto + Fahrer.
async function setupCompany(tag, withConnect = true) {
  const co = await H.registerCompany(tag);
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });
  if (withConnect && stripe) {
    const mail = `co${H.uniq()}@test.de`;
    const acct = await stripe.accounts.create({
      type: "custom",
      country: "DE",
      email: mail,
      business_type: "individual",
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    });
    let ready = await stripe.accounts.update(acct.id, {
      business_profile: { mcc: "4121", url: "https://taxi-qa-demo.de", name: `Firma ${tag}` },
      individual: {
        first_name: "Max", last_name: "Muster", email: mail, phone: "+4915100000000",
        dob: { day: 1, month: 1, year: 1901 },
        address: { line1: "address_full_match", city: "Hannover", postal_code: "30159", country: "DE" },
        id_number: "000000000",
      },
      tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
      external_account: { object: "bank_account", country: "DE", currency: "eur", account_number: "DE89370400440532013000" },
    });
    for (let i = 0; i < 45 && !ready.charges_enabled; i++) {
      await sleep(1500);
      ready = await stripe.accounts.retrieve(acct.id);
    }
    await prisma.company.update({
      where: { slug: co.slug },
      data: { stripeAccountId: acct.id, stripeChargesEnabled: ready.charges_enabled, stripePayoutsEnabled: ready.payouts_enabled },
    });
    co.stripeAccountId = acct.id;
    co.connectReady = ready.charges_enabled;
  }
  const drv = await H.createDriver(co.admin, tag, HBF);
  return { ...co, driver: drv };
}

// Buchung als angemeldeter Kunde.
async function bookAs(cookie, slug, opts = {}) {
  const me = await get("/api/customer/profile", cookie);
  const prof = me.body?.profile ?? me.body ?? {};
  return post(
    "/api/bookings",
    {
      company: slug,
      customerName: prof.name ?? "QA Kunde",
      customerPhone: prof.phone,
      pickupAddress: "Hauptbahnhof",
      pickup: HBF,
      destAddress: "List",
      dest: LIST,
      paymentMethod: opts.paymentMethod ?? "CARD",
      ...(opts.cardId ? { cardId: opts.cardId } : {}),
      ...(opts.scheduledAt ? { scheduledAt: opts.scheduledAt } : {}),
    },
    cookie,
  );
}

// Fahrt komplett durchfahren (Angebot annehmen -> beenden).
async function driveToEnd(socket, offers, bookingId) {
  await offers.match((o) => o.id === bookingId, 30000);
  await emitAck(socket, "driver:respond", { bookingId, accept: true });
  await sleep(400);
  for (const a of ["arrived", "start", "complete"]) {
    await emitAck(socket, "driver:trip", { bookingId, action: a });
    await sleep(250);
  }
  await sleep(900);
}

// ---------------------------------------------------------------------------
async function main() {
  info(`Trinkgeld-Fenster: ${TIP_WINDOW_MS / 1000} s`);
  info(`Stripe: ${stripe ? "echter Testmodus" : "Mock"}`);

  const co = await setupCompany("PAY");
  info(`Firma ${co.slug} | Connect bereit: ${co.connectReady ? "ja" : "nein"}`);
  const sock = await H.goOnline(co.driver.cookie, HBF);
  const offers = collect(sock, "driver:offer");

  // =========================================================================
  caseHead(1, "Neukunde + Barzahlung",
    "Neues Kundenkonto, keine Karte hinterlegt",
    "Fahrt mit Zahlungsart BAR buchen",
    "Buchung geht durch, keine Karte noetig, Status OFFEN");
  const kBar = await registerCustomer("bar");
  check("Kundenkonto angelegt", !!kBar.cookie, kBar.status);
  const barBk = await bookAs(kBar.cookie, co.slug, { paymentMethod: "CASH" });
  check("Barbuchung erfolgreich", barBk.status === 201, { s: barBk.status, e: barBk.body?.error });
  const barDb = await prisma.booking.findUnique({
    where: { id: barBk.body?.id },
    select: { paymentMethod: true, paymentStatus: true, cardId: true, priceAuthorized: true },
  });
  check("Zahlungsart BAR", barDb?.paymentMethod === "CASH", barDb?.paymentMethod);
  check("Keine Karte verknuepft", barDb?.cardId === null, barDb?.cardId);
  check("Keine Kartenreservierung", barDb?.priceAuthorized === null, barDb?.priceAuthorized);
  check("Status OFFEN", barDb?.paymentStatus === "OFFEN", barDb?.paymentStatus);

  // =========================================================================
  caseHead(2, "Neukunde + neue Karte",
    "Neues Kundenkonto ohne Karte",
    "Karte hinterlegen, dann Kartenfahrt buchen",
    "Karte wird bei Stripe gespeichert, Buchung mit Status KARTE_HINTERLEGT");
  const k1 = await registerCustomer("neu");
  const noCard = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD" });
  check("Ohne Karte wird Kartenzahlung abgelehnt (402)", noCard.status === 402 && noCard.body?.code === "CARD_REQUIRED", {
    s: noCard.status, c: noCard.body?.code,
  });
  info(`Meldung: ${noCard.body?.error}`);

  const card1 = await addCard(k1.cookie);
  check("Karte hinterlegt", card1.ok, { s: card1.status, e: card1.error });
  info(`Karte: ${card1.card?.label}`);
  check("Erste Karte ist automatisch Standardkarte", card1.card?.isDefault === true, card1.card);
  const cardsDb = await prisma.customerCard.findMany({ where: { customer: { email: k1.email } } });
  check("Nur Referenz gespeichert, keine Kartennummer",
    cardsDb.every((c) => c.last4.length === 4 && c.stripePaymentMethodId.length > 5 && !/\d{12,}/.test(JSON.stringify(c))),
    cardsDb.map((c) => ({ brand: c.brand, last4: c.last4 })));

  const cardBk = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD" });
  check("Kartenbuchung erfolgreich", cardBk.status === 201, { s: cardBk.status, e: cardBk.body?.error });
  const cardDb = await prisma.booking.findUnique({
    where: { id: cardBk.body?.id },
    select: { paymentStatus: true, cardId: true, priceAuthorized: true, paymentRef: true },
  });
  check("Status KARTE_HINTERLEGT", cardDb?.paymentStatus === "KARTE_HINTERLEGT", cardDb?.paymentStatus);
  check("Karte mit der Fahrt verknuepft", !!cardDb?.cardId, cardDb?.cardId);
  check("KEINE Reservierung auf der Karte", cardDb?.priceAuthorized === null, cardDb?.priceAuthorized);
  check("Noch keine Zahlung ausgeloest", cardDb?.paymentRef === null, cardDb?.paymentRef);

  // =========================================================================
  caseHead(3, "Bestandskunde + gespeicherte Karte",
    "Kunde mit bereits hinterlegter Karte",
    "Erneut buchen, ohne Kartendaten einzugeben",
    "Buchung nutzt automatisch die Standardkarte");
  const again = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD" });
  check("Zweite Buchung ohne erneute Karteneingabe", again.status === 201, again.status);
  const againDb = await prisma.booking.findUnique({ where: { id: again.body?.id }, select: { cardId: true } });
  check("Dieselbe Standardkarte verwendet", againDb?.cardId === cardDb?.cardId, { erst: cardDb?.cardId, dann: againDb?.cardId });
  await prisma.booking.updateMany({ where: { id: again.body?.id }, data: { status: "STORNIERT", trackingStatus: "STORNIERT" } });

  // =========================================================================
  caseHead(4, "Fahrt sofort buchen", "Kunde mit Karte", "Sofortfahrt buchen", "isScheduled = false, sofort in Disposition");
  const sofort = await prisma.booking.findUnique({ where: { id: cardBk.body?.id }, select: { isScheduled: true, trackingStatus: true } });
  check("Sofortfahrt (nicht geplant)", sofort?.isScheduled === false, sofort?.isScheduled);
  check("Direkt in der Fahrersuche", ["SUCHE", "FAHRER_UNTERWEGS", "RESERVIERT_FAHRER"].includes(sofort?.trackingStatus), sofort?.trackingStatus);

  // =========================================================================
  caseHead(5, "Fahrt fuer spaeter am selben Tag",
    "Kunde mit Karte", "Fahrt in 3 Stunden buchen",
    "Vorbestellung, Karte hinterlegt, KEINE Reservierung");
  const heute = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD", scheduledAt: new Date(Date.now() + 3 * 3600_000).toISOString() });
  check("Vorbestellung angelegt", heute.status === 201, heute.status);
  const heuteDb = await prisma.booking.findUnique({
    where: { id: heute.body?.id },
    select: { isScheduled: true, trackingStatus: true, paymentStatus: true, priceAuthorized: true, cardId: true },
  });
  check("Als Vorbestellung markiert", heuteDb?.isScheduled === true && heuteDb?.trackingStatus === "GEPLANT", heuteDb);
  check("Karte vorgemerkt", !!heuteDb?.cardId && heuteDb?.paymentStatus === "KARTE_HINTERLEGT", heuteDb?.paymentStatus);
  check("Kein Geld blockiert", heuteDb?.priceAuthorized === null, heuteDb?.priceAuthorized);

  // =========================================================================
  caseHead(6, "Fahrt mehrere Tage im Voraus",
    "Kunde mit Karte", "Fahrt in 5 Tagen buchen",
    "Karte gespeichert, KEIN mehrtaegiger Hold auf dem Konto");
  const spaeter = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD", scheduledAt: new Date(Date.now() + 5 * 24 * 3600_000).toISOString() });
  check("Buchung 5 Tage im Voraus", spaeter.status === 201, spaeter.status);
  const spaeterDb = await prisma.booking.findUnique({
    where: { id: spaeter.body?.id },
    select: { priceAuthorized: true, paymentRef: true, cardId: true, scheduledAt: true },
  });
  check("Kein Betrag reserviert", spaeterDb?.priceAuthorized === null && spaeterDb?.paymentRef === null, spaeterDb);
  check("Karte fuer spaeter vorgemerkt", !!spaeterDb?.cardId, spaeterDb?.cardId);
  if (stripe) {
    const pis = await stripe.paymentIntents.list({ limit: 5 });
    const holds = pis.data.filter((p) => p.status === "requires_capture");
    check("Bei Stripe existiert KEIN offener Hold fuer diese Fahrt",
      !holds.some((p) => p.metadata?.bookingId === spaeter.body?.id), holds.map((p) => p.id));
  }

  // =========================================================================
  caseHead(7, "Fahrer nimmt zukuenftige Fahrt an",
    "Vorbestellung in 3 Stunden", "Fahrer reserviert sie",
    "Fahrer bleibt frei, Dashboard nicht blockiert, weiterhin keine Abbuchung");
  const st = collect(sock, "driver:state");
  const res = await emitAck(sock, "driver:reserve", { bookingId: heute.body?.id });
  check("Reservierung erfolgreich", res?.ok === true, res);
  await sleep(800);
  const stNow = st.all().slice(-1)[0];
  check("Fahrer bleibt FREI", stNow?.status === "FREI", stNow?.status);
  check("Zukunftsfahrt ist NICHT der aktuelle Auftrag", !stNow?.activeBooking, stNow?.activeBooking?.id);
  const heuteAfter = await prisma.booking.findUnique({ where: { id: heute.body?.id }, select: { paymentStatus: true } });
  check("Weiterhin keine Abbuchung", heuteAfter?.paymentStatus === "KARTE_HINTERLEGT", heuteAfter?.paymentStatus);

  // =========================================================================
  caseHead(8, "Fahrt erfolgreich beenden",
    "Kartenfahrt in Disposition", "Fahrer nimmt an und beendet die Fahrt",
    "Fahrt ABGESCHLOSSEN, Trinkgeld-Fenster offen, noch NICHT bezahlt");
  await driveToEnd(sock, offers, cardBk.body?.id);
  const doneDb = await prisma.booking.findUnique({
    where: { id: cardBk.body?.id },
    select: { status: true, trackingStatus: true, paymentStatus: true, tipPromptedAt: true, fare: true, tip: true },
  });
  check("Fahrt abgeschlossen", doneDb?.status === "ABGESCHLOSSEN" && doneDb?.trackingStatus === "BEENDET", doneDb);
  check("NOCH NICHT bezahlt", doneDb?.paymentStatus === "KARTE_HINTERLEGT", doneDb?.paymentStatus);
  check("Trinkgeld-Fenster geoeffnet", !!doneDb?.tipPromptedAt, doneDb?.tipPromptedAt);
  check("Trinkgeld noch 0", doneDb?.tip === 0, doneDb?.tip);
  info(`Fahrpreis: ${doneDb?.fare} EUR`);

  const payState = await get(`/api/bookings/${cardBk.body?.id}/pay`);
  check("Trinkgeld-Fenster wird als offen gemeldet", payState.body?.tipWindowOpen === true, payState.body);

  // =========================================================================
  caseHead(9, "Kartenzahlung OHNE Trinkgeld",
    "Fahrt beendet, Trinkgeld-Fenster offen", "Kunde waehlt ausdruecklich ohne Trinkgeld",
    "Nur der Fahrpreis wird abgebucht");
  const pay0 = await post(`/api/bookings/${cardBk.body?.id}/pay`, { tip: 0 }, k1.cookie);
  check("Zahlung erfolgreich", pay0.status === 200 && pay0.body?.ok === true, { s: pay0.status, b: pay0.body });
  check("Trinkgeld 0", pay0.body?.tip === 0, pay0.body?.tip);
  check("Betrag = Fahrpreis", Math.abs((pay0.body?.total ?? 0) - (doneDb?.fare ?? 0)) < 0.005, { total: pay0.body?.total, fare: doneDb?.fare });
  const paidDb = await prisma.booking.findUnique({ where: { id: cardBk.body?.id }, select: { paymentStatus: true, paymentRef: true } });
  check("Status BEZAHLT", paidDb?.paymentStatus === "BEZAHLT", paidDb?.paymentStatus);
  check("Zahlungsreferenz gespeichert", !!paidDb?.paymentRef, paidDb?.paymentRef);

  // =========================================================================
  caseHead(10, "Kartenzahlung mit 5 % Trinkgeld",
    "Neue beendete Kartenfahrt", "Kunde waehlt 5 % Trinkgeld",
    "Fahrpreis + 5 % werden abgebucht");
  const t5 = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD" });
  await driveToEnd(sock, offers, t5.body?.id);
  const t5db = await prisma.booking.findUnique({ where: { id: t5.body?.id }, select: { fare: true } });
  const expect5 = Math.round((t5db.fare * 0.05) * 100) / 100;
  const pay5 = await post(`/api/bookings/${t5.body?.id}/pay`, { tipPercent: 5 }, k1.cookie);
  check("Zahlung mit 5 % erfolgreich", pay5.status === 200, { s: pay5.status, b: pay5.body });
  check(`Trinkgeld = ${expect5} EUR`, Math.abs((pay5.body?.tip ?? 0) - expect5) < 0.02, { ist: pay5.body?.tip, soll: expect5 });
  check("Gesamt = Fahrpreis + Trinkgeld", Math.abs((pay5.body?.total ?? 0) - (t5db.fare + expect5)) < 0.02, pay5.body);

  // =========================================================================
  caseHead(11, "Kartenzahlung mit eigenem Trinkgeldbetrag",
    "Neue beendete Kartenfahrt", "Kunde gibt 3,50 EUR Trinkgeld ein",
    "Genau 3,50 EUR Trinkgeld werden aufgeschlagen");
  const tc = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD" });
  await driveToEnd(sock, offers, tc.body?.id);
  const tcdb = await prisma.booking.findUnique({ where: { id: tc.body?.id }, select: { fare: true } });
  const payC = await post(`/api/bookings/${tc.body?.id}/pay`, { tip: 3.5 }, k1.cookie);
  check("Zahlung mit eigenem Betrag erfolgreich", payC.status === 200, payC.status);
  check("Trinkgeld exakt 3,50 EUR", Math.abs((payC.body?.tip ?? 0) - 3.5) < 0.005, payC.body?.tip);
  check("Gesamt korrekt", Math.abs((payC.body?.total ?? 0) - (tcdb.fare + 3.5)) < 0.02, payC.body);

  // =========================================================================
  caseHead(12, "Barzahlung -> KEINE Trinkgeld-Seite",
    "Barfahrt", "Fahrt beenden",
    "Kein Trinkgeld-Fenster, keine Zahlung in der App");
  // Frische Barfahrt: die aus Fall 1 haette ihr Suchfenster laengst ueberschritten.
  const barBk2 = await bookAs(kBar.cookie, co.slug, { paymentMethod: "CASH" });
  check("Neue Barfahrt angelegt", barBk2.status === 201, barBk2.status);
  await driveToEnd(sock, offers, barBk2.body?.id);
  const barDone = await prisma.booking.findUnique({
    where: { id: barBk2.body?.id },
    select: { status: true, paymentStatus: true, tipPromptedAt: true, tip: true },
  });
  check("Fahrt abgeschlossen", barDone?.status === "ABGESCHLOSSEN", barDone?.status);
  check("KEIN Trinkgeld-Fenster geoeffnet", barDone?.tipPromptedAt === null, barDone?.tipPromptedAt);
  check("Kein Trinkgeld erfasst", barDone?.tip === 0, barDone?.tip);
  const barPayState = await get(`/api/bookings/${barBk2.body?.id}/pay`);
  check("Trinkgeld-Fenster gilt als geschlossen", barPayState.body?.tipWindowOpen === false, barPayState.body?.tipWindowOpen);
  const barPay = await post(`/api/bookings/${barBk2.body?.id}/pay`, { tip: 5 }, kBar.cookie);
  check("Zahlung in der App wird abgelehnt (Barfahrt)", barPay.status === 400 && barPay.body?.code === "CASH_RIDE", {
    s: barPay.status, c: barPay.body?.code,
  });

  // =========================================================================
  caseHead(13, "Kunde schliesst die Seite nach Fahrtende",
    "Kartenfahrt beendet, Trinkgeld-Fenster offen", "Kunde reagiert NICHT",
    "Fahrt bleibt offen, bis das Fenster ablaeuft");
  const noResp = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD" });
  await driveToEnd(sock, offers, noResp.body?.id);
  const nrDb = await prisma.booking.findUnique({
    where: { id: noResp.body?.id },
    select: { paymentStatus: true, tipPromptedAt: true },
  });
  check("Zahlung noch offen", nrDb?.paymentStatus === "KARTE_HINTERLEGT", nrDb?.paymentStatus);
  check("Fenster laeuft", !!nrDb?.tipPromptedAt, nrDb?.tipPromptedAt);

  // =========================================================================
  caseHead(14, "Automatische Zahlung ohne Trinkgeld nach Ablauf",
    "Kunde hat nicht reagiert", `Warten bis das Fenster (${TIP_WINDOW_MS / 1000} s) ablaeuft`,
    "Fahrpreis wird automatisch OHNE Trinkgeld abgebucht");
  const waitMs = TIP_WINDOW_MS + 35_000;
  info(`Warte ${Math.round(waitMs / 1000)} s auf die automatische Abrechnung ...`);
  let autoDb = null;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(4000);
    autoDb = await prisma.booking.findUnique({
      where: { id: noResp.body?.id },
      select: { paymentStatus: true, tip: true, fare: true, paymentRef: true },
    });
    if (autoDb?.paymentStatus === "BEZAHLT") break;
  }
  check("Automatisch abgerechnet", autoDb?.paymentStatus === "BEZAHLT", autoDb?.paymentStatus);
  check("OHNE Trinkgeld", autoDb?.tip === 0, autoDb?.tip);
  check("Zahlung tatsaechlich ausgefuehrt", !!autoDb?.paymentRef, autoDb?.paymentRef);
  info(`Automatisch belastet: ${autoDb?.fare} EUR`);

  // =========================================================================
  caseHead(15, "Karte wird abgelehnt",
    "Kunde mit Karte, die bei der Belastung abgelehnt wird", "Fahrt beenden und zahlen",
    "Status FEHLGESCHLAGEN, Fahrt NICHT als bezahlt markiert, Klartext-Meldung");
  const kDecl = await registerCustomer("abgelehnt");
  const declCard = await addCard(kDecl.cookie, "pm_card_chargeCustomerFail");
  check("Karte hinterlegt (wird spaeter abgelehnt)", declCard.ok, declCard.error);
  const declBk = await bookAs(kDecl.cookie, co.slug, { paymentMethod: "CARD" });
  check("Buchung mit dieser Karte moeglich", declBk.status === 201, declBk.status);
  await driveToEnd(sock, offers, declBk.body?.id);
  const declPay = await post(`/api/bookings/${declBk.body?.id}/pay`, { tip: 0 }, kDecl.cookie);
  if (stripe) {
    check("Zahlung wird abgelehnt (402)", declPay.status === 402, { s: declPay.status, b: declPay.body });
    info(`Meldung an den Kunden: ${declPay.body?.error}`);
    info(`Grund: ${declPay.body?.detail}`);
    const declDb = await prisma.booking.findUnique({
      where: { id: declBk.body?.id },
      select: { paymentStatus: true, paymentError: true, status: true },
    });
    check("Status FEHLGESCHLAGEN (= Zahlung ausstehend)", declDb?.paymentStatus === "FEHLGESCHLAGEN", declDb?.paymentStatus);
    check("Fahrt NICHT als bezahlt markiert", declDb?.paymentStatus !== "BEZAHLT", declDb?.paymentStatus);
    check("Fahrt bleibt abgeschlossen", declDb?.status === "ABGESCHLOSSEN", declDb?.status);
    check("Klartext-Fehlergrund gespeichert", !!declDb?.paymentError, declDb?.paymentError);
    check("Andere Karten werden zur Auswahl angeboten", Array.isArray(declPay.body?.cards), declPay.body?.cards?.length);
  } else {
    info("Uebersprungen (Mock-Modus)");
  }

  // =========================================================================
  caseHead(16, "Karte abgelaufen",
    "Kunde mit abgelaufener Karte", "Fahrt buchen bzw. bezahlen",
    "Buchung wird abgelehnt bzw. Zahlung schlaegt mit klarer Meldung fehl");
  const kExp = await registerCustomer("abgelaufen");
  const expCard = await addCard(kExp.cookie);
  await prisma.customerCard.update({
    where: { id: expCard.card.id },
    data: { expMonth: 1, expYear: new Date().getFullYear() - 1 },
  });
  const expBk = await bookAs(kExp.cookie, co.slug, { paymentMethod: "CARD" });
  check("Buchung mit abgelaufener Karte abgelehnt (402)", expBk.status === 402, { s: expBk.status, e: expBk.body?.error });
  info(`Meldung: ${expBk.body?.error}`);

  // =========================================================================
  caseHead(17, "Kunde wechselt die Karte",
    "Kunde hat zwei Karten", "Zweite Karte hinzufuegen und als Standard setzen",
    "Standardkarte wechselt, neue Buchung nutzt die neue Karte");
  const card2 = await addCard(k1.cookie, "pm_card_mastercard");
  check("Zweite Karte hinterlegt", card2.ok, card2.error);
  const list2 = await get("/api/customer/payment-methods", k1.cookie);
  check("Beide Karten sichtbar", (list2.body?.cards ?? []).length >= 2, (list2.body?.cards ?? []).map((c) => c.label));
  check("Nur EINE Standardkarte", (list2.body?.cards ?? []).filter((c) => c.isDefault).length === 1);
  const setDef = await patch(`/api/customer/payment-methods/${card2.card.id}`, { isDefault: true }, k1.cookie);
  check("Standardkarte gewechselt", setDef.status === 200, setDef.status);
  const nowDefault = (setDef.body?.cards ?? []).find((c) => c.isDefault);
  check("Neue Karte ist Standard", nowDefault?.id === card2.card.id, nowDefault);
  const bkNew = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD" });
  const bkNewDb = await prisma.booking.findUnique({ where: { id: bkNew.body?.id }, select: { cardId: true } });
  check("Neue Buchung nutzt die neue Standardkarte", bkNewDb?.cardId === card2.card.id, bkNewDb?.cardId);
  // Gezielt die andere Karte fuer eine Fahrt verwenden
  const bkPick = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD", cardId: card1.card.id });
  const bkPickDb = await prisma.booking.findUnique({ where: { id: bkPick.body?.id }, select: { cardId: true } });
  check("Andere Karte gezielt fuer eine Fahrt waehlbar", bkPickDb?.cardId === card1.card.id, bkPickDb?.cardId);
  await prisma.booking.updateMany({
    where: { id: { in: [bkNew.body?.id, bkPick.body?.id] } },
    data: { status: "STORNIERT", trackingStatus: "STORNIERT" },
  });

  // =========================================================================
  caseHead(18, "Fahrer storniert vor Fahrtbeginn",
    "Kartenfahrt zugewiesen", "Fahrer storniert",
    "Keine Belastung, Karte freigegeben");
  const cancelBk = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD" });
  await offers.match((o) => o.id === cancelBk.body?.id, 30000);
  await emitAck(sock, "driver:respond", { bookingId: cancelBk.body?.id, accept: true });
  await sleep(400);
  await emitAck(sock, "driver:trip", { bookingId: cancelBk.body?.id, action: "cancel" });
  await sleep(900);
  const cancelDb = await prisma.booking.findUnique({
    where: { id: cancelBk.body?.id },
    select: { status: true, paymentStatus: true, paymentRef: true },
  });
  check("Fahrt storniert", cancelDb?.status === "STORNIERT", cancelDb?.status);
  check("Keine Zahlung ausgeloest", cancelDb?.paymentStatus !== "BEZAHLT", cancelDb?.paymentStatus);
  check("Karte freigegeben", cancelDb?.paymentStatus === "STORNIERT", cancelDb?.paymentStatus);

  // =========================================================================
  caseHead(19, "Kunde storniert",
    "Kartenfahrt in Suche", "Kunde storniert selbst",
    "Keine Belastung (keine Storno-Gebuehr hinterlegt)");
  const custCancel = await bookAs(k1.cookie, co.slug, { paymentMethod: "CARD" });
  const cc = await post(`/api/bookings/${custCancel.body?.id}/cancel`, { reason: "Test" }, k1.cookie);
  check("Stornierung akzeptiert", cc.status === 200 || cc.status === 201, cc.status);
  await sleep(800);
  const ccDb = await prisma.booking.findUnique({
    where: { id: custCancel.body?.id },
    select: { status: true, paymentStatus: true },
  });
  check("Fahrt storniert", ccDb?.status === "STORNIERT", ccDb?.status);
  check("Keine Belastung", ccDb?.paymentStatus !== "BEZAHLT", ccDb?.paymentStatus);

  // =========================================================================
  caseHead(20, "Zahlung landet beim richtigen Taxiunternehmen",
    "Bezahlte Kartenfahrt", "Zahlungsziel bei Stripe pruefen",
    "transfer_data.destination = Connect-Konto der Firma");
  if (stripe && co.connectReady && paidDb?.paymentRef) {
    const pi = await stripe.paymentIntents.retrieve(paidDb.paymentRef, { expand: ["latest_charge"] });
    check("Zahlung erfolgreich", pi.status === "succeeded", pi.status);
    check("Ziel = Connect-Konto der Firma", pi.transfer_data?.destination === co.stripeAccountId, {
      ist: pi.transfer_data?.destination, soll: co.stripeAccountId,
    });
    const charge = pi.latest_charge;
    check("Transfer an die Firma erzeugt", !!charge?.transfer, charge?.transfer);
    if (charge?.transfer) {
      const tr = await stripe.transfers.retrieve(charge.transfer);
      const bookingRow = await prisma.booking.findUnique({ where: { id: cardBk.body?.id }, select: { fare: true, tip: true } });
      check("Firma erhaelt den VOLLEN Betrag", Math.abs(tr.amount / 100 - (bookingRow.fare + bookingRow.tip)) < 0.02, {
        transfer: tr.amount / 100, soll: bookingRow.fare + bookingRow.tip,
      });
    }
    // =====================================================================
    caseHead(21, "Plattform erhaelt KEINE Fahrtenprovision",
      "Dieselbe Zahlung", "application_fee und Provisionsfelder pruefen",
      "Keine Gebuehr, companyNet = Fahrpreis");
    check("Keine application_fee bei Stripe", !pi.application_fee_amount, pi.application_fee_amount);
    const feeRow = await prisma.booking.findUnique({
      where: { id: cardBk.body?.id },
      select: { platformFee: true, platformFeeRate: true, companyNet: true, fare: true },
    });
    check("platformFee = 0", feeRow?.platformFee === 0, feeRow?.platformFee);
    check("companyNet = Fahrpreis", Math.abs((feeRow?.companyNet ?? 0) - (feeRow?.fare ?? 0)) < 0.005, feeRow);
  } else {
    info("Faelle 20/21 uebersprungen (kein verifiziertes Connect-Konto)");
  }

  // =========================================================================
  caseHead(22, "Eine gespeicherte Karte bei VERSCHIEDENEN Taxiunternehmen",
    "Kunde hat eine Karte, zwei verschiedene Firmen", "Bei Firma B mit derselben Karte fahren",
    "Zahlung funktioniert ohne erneute Karteneingabe, Geld geht an Firma B");
  const coB = await setupCompany("PAYB");
  info(`Firma B: ${coB.slug} | Connect bereit: ${coB.connectReady ? "ja" : "nein"}`);
  check("Firma B ist zahlungsbereit (fuer den Zielnachweis)", !stripe || coB.connectReady === true, coB.connectReady);
  const sockB = await H.goOnline(coB.driver.cookie, HBF);
  const offersB = collect(sockB, "driver:offer");
  const bkB = await bookAs(k1.cookie, coB.slug, { paymentMethod: "CARD", cardId: card1.card.id });
  check("Buchung bei Firma B ohne neue Karteneingabe", bkB.status === 201, { s: bkB.status, e: bkB.body?.error });
  await driveToEnd(sockB, offersB, bkB.body?.id);
  const payB = await post(`/api/bookings/${bkB.body?.id}/pay`, { tip: 0 }, k1.cookie);
  check("Zahlung bei Firma B erfolgreich", payB.status === 200, { s: payB.status, b: payB.body });
  const bDb = await prisma.booking.findUnique({ where: { id: bkB.body?.id }, select: { paymentStatus: true, paymentRef: true, cardId: true } });
  check("Dieselbe Karte verwendet", bDb?.cardId === card1.card.id, bDb?.cardId);
  check("Als bezahlt verbucht", bDb?.paymentStatus === "BEZAHLT", bDb?.paymentStatus);
  if (stripe && coB.connectReady && bDb?.paymentRef) {
    const piB = await stripe.paymentIntents.retrieve(bDb.paymentRef);
    check("Geld ging an Firma B (nicht an Firma A)", piB.transfer_data?.destination === coB.stripeAccountId, {
      ist: piB.transfer_data?.destination, firmaA: co.stripeAccountId, firmaB: coB.stripeAccountId,
    });
  }

  // =========================================================================
  section("Zusatz: Karte entfernen + Kontosperre");
  const delCard = await del(`/api/customer/payment-methods/${card2.card.id}`, k1.cookie);
  check("Karte entfernbar", delCard.status === 200, { s: delCard.status, e: delCard.body?.error });
  const afterDel = await get("/api/customer/payment-methods", k1.cookie);
  check("Es bleibt eine Standardkarte", (afterDel.body?.cards ?? []).some((c) => c.isDefault), afterDel.body?.cards);

  const kBlock = await registerCustomer("gesperrt");
  await addCard(kBlock.cookie);
  await prisma.customer.updateMany({ where: { email: kBlock.email }, data: { blocked: true, blockedReason: "Offene Zahlung" } });
  const blockedBk = await bookAs(kBlock.cookie, co.slug, { paymentMethod: "CARD" });
  check("Gesperrtes Konto kann nicht buchen (403)", blockedBk.status === 403 && blockedBk.body?.code === "ACCOUNT_BLOCKED", {
    s: blockedBk.status, c: blockedBk.body?.code,
  });
  info(`Meldung: ${blockedBk.body?.error}`);

  sock.close();
  sockB.close();
  await prisma.$disconnect();
  finish("PAYMENT-FLOW");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message, e.stack?.split("\n")[1] ?? "");
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
