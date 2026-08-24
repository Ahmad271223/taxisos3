// QA: Buchen als angemeldeter Kunde (Konto) + Gruppen-/Event-Buchung.
//
// Prueft:
//  - Kann ein Kunde mit Konto ein Taxi buchen (bar und per Karte)?
//  - Erscheint die Fahrt im Konto unter "Meine Fahrten"?
//  - Gruppen-/Event-Buchung mit Bar und mit Kartenzahlung
//  - Bei Gruppen-Kartenzahlung gelten dieselben Regeln wie sonst
//
// Aufruf: node scripts/qa/account_group.js
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
  const reg = await post("/api/customer/register", {
    name: `Konto ${tag}`,
    email: `konto${tag}${id}@test.de`,
    phone,
    password: "Pass1234",
  });
  return { cookie: reg.cookie, phone, status: reg.status, name: `Konto ${tag}` };
}

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

async function main() {
  const co = await H.registerCompany("KONTO");
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });
  // Gruppenfahrten verlangen Grossraumwagen -> passenden Fahrer anlegen.
  const drv = await H.createDriver(co.admin, "K", HBF, { vehicleClass: "VAN", vehicleSeats: 8 });
  const sock = await H.goOnline(drv.cookie, HBF);
  const offers = H.collect(sock, "driver:offer");

  // =========================================================================
  section("1) Mit Kundenkonto ein Taxi buchen (Barzahlung)");
  const k = await registerCustomer("A");
  check("Konto angelegt", !!k.cookie, k.status);
  const me = await get("/api/auth/me", k.cookie);
  check("Angemeldet als Kunde", me.body?.customer?.role === "CUSTOMER", me.body?.customer ?? me.body);

  const bar = await post("/api/bookings", {
    company: co.slug, customerName: k.name, customerPhone: k.phone,
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH",
  }, k.cookie);
  check("Barfahrt als Kontoinhaber buchbar", bar.status === 201, { s: bar.status, e: bar.body?.error });
  const barDb = await prisma.booking.findUnique({
    where: { id: bar.body?.id },
    select: { customerId: true, paymentMethod: true },
  });
  check("Fahrt ist dem Konto zugeordnet", !!barDb?.customerId, barDb?.customerId);
  check("Keine erneute SMS-Bestätigung nötig", bar.status === 201);

  section("2) Fahrt erscheint im Konto");
  const myRides = await get("/api/customer/bookings", k.cookie);
  check("Fahrtenliste abrufbar", myRides.status === 200, myRides.status);
  const found = (myRides.body?.bookings ?? []).some((b) => b.id === bar.body?.id);
  check("Gebuchte Fahrt steht in 'Meine Fahrten'", found, (myRides.body?.bookings ?? []).length);

  // =========================================================================
  section("3) Mit Kundenkonto per Karte buchen");
  const card = await addCard(k.cookie);
  check("Karte im Konto hinterlegt", card.ok, card.error);
  const kartenfahrt = await post("/api/bookings", {
    company: co.slug, customerName: k.name, customerPhone: k.phone,
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CARD",
  }, k.cookie);
  check("Kartenfahrt buchbar", kartenfahrt.status === 201, { s: kartenfahrt.status, e: kartenfahrt.body?.error });
  const kfDb = await prisma.booking.findUnique({
    where: { id: kartenfahrt.body?.id },
    select: { cardId: true, paymentStatus: true, customerId: true },
  });
  check("Gespeicherte Karte wird verwendet", !!kfDb?.cardId, kfDb?.cardId);
  check("Status KARTE_HINTERLEGT", kfDb?.paymentStatus === "KARTE_HINTERLEGT", kfDb?.paymentStatus);

  // =========================================================================
  section("4) Gruppen-/Event-Buchung mit BARZAHLUNG");
  const gruppeBar = await post("/api/groups", {
    company: co.slug,
    customerName: k.name, customerPhone: k.phone,
    pickupAddress: "Hauptbahnhof", pickup: HBF,
    destAddress: "Messegelände", dest: LIST,
    totalPassengers: 15, totalLuggage: 0,
    eventLabel: "Hochzeit Müller",
    vehicles: [{ vehicleClass: "VAN", count: 2 }],
    paymentMethod: "CASH",
  }, k.cookie);
  check("Gruppenbuchung (bar) erfolgreich", gruppeBar.status === 201, { s: gruppeBar.status, e: gruppeBar.body?.error });
  const groupId = gruppeBar.body?.group?.id ?? gruppeBar.body?.id;
  const kinderBar = await prisma.booking.findMany({
    where: { groupId },
    select: { id: true, paymentMethod: true, paymentStatus: true, cardId: true },
  });
  info(`${kinderBar.length} Einzelfahrten erzeugt`);
  check("Zwei Fahrzeuge = zwei Fahrten", kinderBar.length === 2, kinderBar.length);
  check("Alle Fahrten auf BAR", kinderBar.every((b) => b.paymentMethod === "CASH"), kinderBar.map((b) => b.paymentMethod));
  check("Keine Karte verknüpft", kinderBar.every((b) => b.cardId === null));

  // =========================================================================
  section("5) Gruppen-/Event-Buchung mit KARTENZAHLUNG");
  const gruppeKarte = await post("/api/groups", {
    company: co.slug,
    customerName: k.name, customerPhone: k.phone,
    pickupAddress: "Hauptbahnhof", pickup: HBF,
    destAddress: "Messegelände", dest: LIST,
    totalPassengers: 12, totalLuggage: 4,
    eventLabel: "Messe-Shuttle",
    vehicles: [{ vehicleClass: "VAN", count: 2 }],
    paymentMethod: "CARD",
  }, k.cookie);
  check("Gruppenbuchung (Karte) erfolgreich", gruppeKarte.status === 201, { s: gruppeKarte.status, e: gruppeKarte.body?.error });
  const groupId2 = gruppeKarte.body?.group?.id ?? gruppeKarte.body?.id;
  const kinderKarte = await prisma.booking.findMany({
    where: { groupId: groupId2 },
    select: { id: true, paymentMethod: true, paymentStatus: true, cardId: true, priceAuthorized: true },
  });
  check("Zwei Fahrten erzeugt", kinderKarte.length === 2, kinderKarte.length);
  check("Alle Fahrten auf KARTE", kinderKarte.every((b) => b.paymentMethod === "CARD"), kinderKarte.map((b) => b.paymentMethod));
  check("Jede Fahrt hat die gespeicherte Karte", kinderKarte.every((b) => !!b.cardId), kinderKarte.map((b) => b.cardId));
  check("Status KARTE_HINTERLEGT", kinderKarte.every((b) => b.paymentStatus === "KARTE_HINTERLEGT"),
    kinderKarte.map((b) => b.paymentStatus));
  check("KEIN Geld reserviert", kinderKarte.every((b) => b.priceAuthorized === null));

  section("6) Gruppen-Kartenzahlung ohne Karte wird abgelehnt");
  const ohneKonto = await post("/api/groups", {
    company: co.slug,
    customerName: "Gast", customerPhone: "+4915100000099",
    pickupAddress: "Hauptbahnhof", pickup: HBF,
    destAddress: "Messe", dest: LIST,
    totalPassengers: 8,
    vehicles: [{ vehicleClass: "VAN", count: 1 }],
    paymentMethod: "CARD",
  });
  check("Ohne Anmeldung keine Gruppen-Kartenzahlung", ohneKonto.status === 401 || ohneKonto.status === 402, {
    s: ohneKonto.status, c: ohneKonto.body?.code,
  });
  info(`Meldung: ${ohneKonto.body?.error}`);

  // =========================================================================
  section("7) Gruppenfahrt durchführen -> jede Fahrt wird einzeln abgerechnet");
  const erste = kinderKarte[0];
  let gotOffer = true;
  try {
    await offers.match((o) => o.id === erste.id, 30000);
  } catch {
    gotOffer = false;
  }
  check("Fahrer erhält eine der Gruppenfahrten", gotOffer);
  if (gotOffer) {
    await H.emitAck(sock, "driver:respond", { bookingId: erste.id, accept: true });
    await sleep(400);
    for (const a of ["arrived", "start", "complete"]) {
      await H.emitAck(sock, "driver:trip", { bookingId: erste.id, action: a });
      await sleep(250);
    }
    await sleep(900);
    const nachFahrt = await prisma.booking.findUnique({
      where: { id: erste.id },
      select: { status: true, paymentStatus: true, tipPromptedAt: true },
    });
    check("Fahrt abgeschlossen", nachFahrt?.status === "ABGESCHLOSSEN", nachFahrt?.status);
    check("Trinkgeld-Fenster geöffnet (wie bei Einzelfahrt)", !!nachFahrt?.tipPromptedAt, nachFahrt?.tipPromptedAt);
    const bezahlt = await post(`/api/bookings/${erste.id}/pay`, { tip: 0 }, k.cookie);
    check("Einzelne Gruppenfahrt bezahlbar", bezahlt.status === 200, { s: bezahlt.status, e: bezahlt.body?.error });
    const danach = await prisma.booking.findUnique({ where: { id: erste.id }, select: { paymentStatus: true } });
    check("Als bezahlt verbucht", danach?.paymentStatus === "BEZAHLT", danach?.paymentStatus);
    const andere = await prisma.booking.findUnique({ where: { id: kinderKarte[1].id }, select: { paymentStatus: true } });
    check("Die zweite Fahrt bleibt unberührt offen", andere?.paymentStatus === "KARTE_HINTERLEGT", andere?.paymentStatus);
  }

  sock.close();
  await prisma.$disconnect();
  finish("KONTO-GRUPPE");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
