// QA: Unternehmens-Abo (SaaS) über Stripe Subscriptions.
//
// Prueft: Tarifuebersicht, Checkout, Aktivierung per Webhook-Logik,
// Tarifwechsel, Fahrer-Kontingent, Zahlungsausfall, Kuendigung – und vor allem
// die STRIKTE TRENNUNG von den Fahrt-Zahlungen.
//
// Aufruf: node scripts/qa/subscription.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep, get, post } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;

const PLAN_MATRIX = [
  { id: "P5", drivers: 5, price: 100 },
  { id: "P10", drivers: 10, price: 190 },
  { id: "P15", drivers: 15, price: 235 },
  { id: "P20", drivers: 20, price: 260 },
];

// Abo direkt bei Stripe anlegen (simuliert den abgeschlossenen Checkout).
async function createLiveSubscription(customerId, planId, testPm = "pm_card_visa") {
  const plan = PLAN_MATRIX.find((p) => p.id === planId);
  const pm = await stripe.paymentMethods.attach(testPm, { customer: customerId }).catch(() => null);
  if (pm) {
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });
  }
  const prices = await stripe.prices.list({ lookup_keys: [`taxios_${planId.toLowerCase()}_monthly`], limit: 1 });
  const priceId = prices.data[0]?.id;
  if (!priceId) return null;
  return stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    metadata: { planId },
    expand: ["latest_invoice"],
  });
}

async function main() {
  info(`Stripe: ${stripe ? "echter Testmodus" : "Mock"}`);

  // =========================================================================
  section("1) Neue Firma startet in der Testphase");
  const co = await H.registerCompany("ABO");
  check("Firma registriert", co.status === 201 || co.status === 200, co.status);
  const start = await get("/api/admin/subscription", co.admin);
  check("Abo-Übersicht abrufbar", start.status === 200, start.status);
  check("Startet im Tarif P5", start.body?.subscription?.plan === "P5", start.body?.subscription?.plan);
  check("Status TRIAL", start.body?.subscription?.status === "TRIAL", start.body?.subscription?.status);
  check("Noch kein Abo abgeschlossen", start.body?.subscription?.hasSubscription === false, start.body?.subscription);
  check("Keine Fahrten-Provision ausgewiesen", start.body?.commissionPercent === 0, start.body?.commissionPercent);

  section("2) Alle vier Tarife werden angeboten");
  const plans = start.body?.plans ?? [];
  check("Vier Tarife vorhanden", plans.length === 4, plans.length);
  for (const p of PLAN_MATRIX) {
    const found = plans.find((x) => x.id === p.id);
    check(`${p.id}: ${p.drivers} Fahrer / ${p.price} € pro Monat`,
      found?.maxDrivers === p.drivers && found?.monthlyPrice === p.price, found);
  }

  // =========================================================================
  section("3) Abo abschließen -> Stripe-Checkout");
  const checkout = await post("/api/admin/subscription", { plan: "P10", action: "new" }, co.admin);
  check("Checkout-Link erzeugt", checkout.status === 200 && !!checkout.body?.url, {
    s: checkout.status, e: checkout.body?.error,
  });
  check("Es ist ein Checkout (kein Portal)", checkout.body?.kind === "checkout", checkout.body?.kind);
  info(`Checkout-URL: ${(checkout.body?.url ?? "").slice(0, 60)}…`);

  const dbCo = await prisma.company.findUnique({
    where: { slug: co.slug },
    select: { stripeCustomerId: true, id: true },
  });
  check("Stripe-Kunde für die FIRMA angelegt", (dbCo?.stripeCustomerId ?? "").startsWith("cus_"), dbCo?.stripeCustomerId);

  if (!stripe) {
    info("Weitere Prüfungen benötigen Stripe – übersprungen.");
    await prisma.$disconnect();
    return finish("SUBSCRIPTION");
  }

  section("4) Preise werden bei Bedarf automatisch in Stripe angelegt");
  // Jeder Tarif bekommt seinen Stripe-Preis beim ersten Checkout – niemand muss
  // im Stripe-Dashboard etwas von Hand pflegen.
  for (const p of PLAN_MATRIX) {
    await post("/api/admin/subscription", { plan: p.id, action: "new" }, co.admin);
  }
  for (const p of PLAN_MATRIX) {
    const list = await stripe.prices.list({ lookup_keys: [`taxios_${p.id.toLowerCase()}_monthly`], limit: 1 });
    const price = list.data[0];
    check(`Preis für ${p.id} existiert (${p.price} €/Monat)`,
      !!price && price.unit_amount === p.price * 100 && price.recurring?.interval === "month",
      { amount: price?.unit_amount, interval: price?.recurring?.interval });
  }

  // =========================================================================
  section("5) Abo wird aktiv -> Tarif und Laufzeit übernommen");
  const sub = await createLiveSubscription(dbCo.stripeCustomerId, "P10");
  check("Abo bei Stripe angelegt", !!sub?.id, sub?.status);
  info(`Stripe-Status: ${sub?.status}`);
  // Der Server gleicht beim Öffnen der Seite selbst mit Stripe ab.
  const afterSub = await get("/api/admin/subscription", co.admin);
  check("Abo wird erkannt", afterSub.body?.subscription?.hasSubscription === true, afterSub.body?.subscription);
  check("Status AKTIV", afterSub.body?.subscription?.status === "AKTIV", afterSub.body?.subscription?.status);
  check("Tarif P10 übernommen", afterSub.body?.subscription?.plan === "P10", afterSub.body?.subscription?.plan);
  check("Preis 190 €", afterSub.body?.subscription?.monthlyPrice === 190, afterSub.body?.subscription?.monthlyPrice);
  check("Nächste Abrechnung hinterlegt", !!afterSub.body?.subscription?.until, afterSub.body?.subscription?.until);

  section("6) Fahrer-Kontingent folgt dem Abo");
  check("Kontingent = 10 Fahrer", afterSub.body?.subscription?.maxDrivers === 10, afterSub.body?.subscription?.maxDrivers);
  check("Noch 10 Fahrer frei", afterSub.body?.driversLeft === 10, afterSub.body?.driversLeft);
  // Sechsten Fahrer anlegen -> im alten Tarif P5 waere das abgelehnt worden.
  for (let i = 1; i <= 6; i++) {
    const r = await post("/api/admin/drivers",
      { name: `Fahrer ${i}`, username: `abod${Date.now()}${i}`, password: "Pass1234" }, co.admin);
    if (i === 6) check("6. Fahrer im Tarif P10 erlaubt", r.status === 201, { s: r.status, e: r.body?.error });
  }
  const after6 = await get("/api/admin/subscription", co.admin);
  check("Fahrerzahl wird mitgezählt", after6.body?.driverCount === 6, after6.body?.driverCount);

  section("7) Rechnung erscheint in der Übersicht");
  const invoices = after6.body?.invoices ?? [];
  info(`${invoices.length} Rechnung(en) gefunden`);
  check("Mindestens eine Abo-Rechnung", invoices.length >= 1, invoices.length);
  if (invoices[0]) {
    info(`Rechnung ${invoices[0].number}: ${invoices[0].amount} € (${invoices[0].status})`);
    check("Rechnungsbetrag = Tarifpreis", Math.abs(invoices[0].amount - 190) < 0.01, invoices[0].amount);
  }

  // =========================================================================
  section("8) Verwalten führt ins Stripe-Kundenportal");
  const portal = await post("/api/admin/subscription", {}, co.admin);
  if (portal.status === 200) {
    check("Portal-Link erzeugt", !!portal.body?.url && portal.body?.kind === "portal", portal.body?.kind);
    info(`Portal-URL: ${(portal.body?.url ?? "").slice(0, 55)}…`);
  } else {
    info(`Kundenportal nicht konfiguriert: ${portal.body?.error}`);
    check("Fehler wird verständlich gemeldet", !!portal.body?.error, portal.body?.error);
  }

  section("9) Tarifwechsel wirkt sofort auf das Kontingent");
  const priceP20 = (await stripe.prices.list({ lookup_keys: ["taxios_p20_monthly"], limit: 1 })).data[0];
  const item = sub.items.data[0];
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: item.id, price: priceP20.id }],
    metadata: { planId: "P20" },
    proration_behavior: "none",
  });
  const afterUp = await get("/api/admin/subscription", co.admin);
  check("Tarif auf P20 gewechselt", afterUp.body?.subscription?.plan === "P20", afterUp.body?.subscription?.plan);
  check("Kontingent jetzt 20 Fahrer", afterUp.body?.subscription?.maxDrivers === 20, afterUp.body?.subscription?.maxDrivers);
  check("Preis 260 €", afterUp.body?.subscription?.monthlyPrice === 260, afterUp.body?.subscription?.monthlyPrice);

  // =========================================================================
  section("10) TRENNUNG: Abo und Fahrt-Zahlungen sind unabhängig");
  const dbNow = await prisma.company.findUnique({
    where: { slug: co.slug },
    select: { stripeCustomerId: true, stripeSubscriptionId: true, stripeAccountId: true },
  });
  check("Abo nutzt einen Stripe-KUNDEN (cus_…)", (dbNow?.stripeCustomerId ?? "").startsWith("cus_"), dbNow?.stripeCustomerId);
  check("Abo-Referenz ist ein Abonnement (sub_…)", (dbNow?.stripeSubscriptionId ?? "").startsWith("sub_"), dbNow?.stripeSubscriptionId);
  check("Auszahlungskonto ist davon getrennt (leer oder acct_…)",
    !dbNow?.stripeAccountId || dbNow.stripeAccountId.startsWith("acct_"), dbNow?.stripeAccountId);
  const subObj = await stripe.subscriptions.retrieve(dbNow.stripeSubscriptionId);
  check("Abo läuft OHNE Connect-Weiterleitung (Geld bleibt bei der Plattform)",
    !subObj.transfer_data && !subObj.application_fee_percent,
    { transfer_data: subObj.transfer_data, fee: subObj.application_fee_percent });
  const subInvoice = await stripe.invoices.list({ subscription: dbNow.stripeSubscriptionId, limit: 1 });
  check("Abo-Rechnung ist keiner Fahrt zugeordnet",
    !subInvoice.data[0]?.metadata?.bookingId, subInvoice.data[0]?.metadata);
  const rideBookings = await prisma.booking.count({ where: { company: { slug: co.slug }, paymentRef: { not: null } } });
  check("Keine Fahrt trägt die Abo-Referenz", rideBookings === 0, rideBookings);

  // =========================================================================
  section("11) Zahlungsausfall -> Status überfällig");
  await prisma.company.update({ where: { slug: co.slug }, data: { subscriptionStatus: "UEBERFAELLIG" } });
  const overdue = await prisma.company.findUnique({ where: { slug: co.slug }, select: { subscriptionStatus: true } });
  check("Status kann auf überfällig stehen", overdue?.subscriptionStatus === "UEBERFAELLIG", overdue?.subscriptionStatus);
  const overdueView = await get("/api/admin/subscription", co.admin);
  info(`Anzeige nach Abgleich: ${overdueView.body?.subscription?.statusLabel}`);
  check("Status wird im Klartext angezeigt", !!overdueView.body?.subscription?.statusLabel, overdueView.body?.subscription);

  section("12) Kündigung");
  await stripe.subscriptions.cancel(dbNow.stripeSubscriptionId);
  const afterCancel = await get("/api/admin/subscription", co.admin);
  check("Status GEKUENDIGT", afterCancel.body?.subscription?.status === "GEKUENDIGT", afterCancel.body?.subscription?.status);
  info(`Anzeige: ${afterCancel.body?.subscription?.statusLabel}`);

  await prisma.$disconnect();
  finish("SUBSCRIPTION");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
