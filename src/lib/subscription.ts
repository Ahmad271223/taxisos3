// Unternehmens-Abo (SaaS) über Stripe Subscriptions.
//
// STRIKT GETRENNT von den Fahrt-Zahlungen:
//   Fahrt   -> Karte des FAHRGASTS, Destination-Charge auf das Connect-Konto
//              des Taxiunternehmens (lib/settle.ts). Plattform behaelt 0 %.
//   Abo     -> Karte des UNTERNEHMENS, normale Zahlung auf das
//              Plattform-Konto (diese Datei). Das ist unser einziger Umsatz.
// Beide nutzen unterschiedliche Stripe-Kunden, Produkte und Code-Pfade.

import { prisma } from "./prisma";
import { PLANS, getPlan, type Plan } from "./plans";

type StripeLike = any;
let clientPromise: Promise<StripeLike | null> | null = null;

async function getClient(): Promise<StripeLike | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!clientPromise) {
    clientPromise = import("stripe")
      .then((m: any) => new (m.default ?? m)(process.env.STRIPE_SECRET_KEY as string))
      .catch(() => null);
  }
  return clientPromise;
}

export function subscriptionsEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

function baseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// Abo-Status im Klartext.
export const SUBSCRIPTION_LABEL: Record<string, string> = {
  TRIAL: "Testphase",
  AKTIV: "Aktiv",
  UEBERFAELLIG: "Zahlung überfällig",
  GEKUENDIGT: "Gekündigt",
};

// Stripe-Status -> unser Status.
export function mapStripeStatus(s: string): string {
  if (s === "active" || s === "trialing") return "AKTIV";
  if (s === "past_due" || s === "unpaid" || s === "incomplete") return "UEBERFAELLIG";
  if (s === "canceled" || s === "incomplete_expired") return "GEKUENDIGT";
  return "UEBERFAELLIG";
}

/**
 * Preis-Objekt für einen Tarif holen bzw. anlegen (idempotent über lookup_key).
 * So muss im Stripe-Dashboard nichts von Hand gepflegt werden.
 */
async function ensurePrice(client: StripeLike, plan: Plan): Promise<string | null> {
  const lookupKey = `taxios_${plan.id.toLowerCase()}_monthly`;
  try {
    const found = await client.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    if (found.data.length) return found.data[0].id;

    const product = await client.products.create({
      name: `TaxiOS Unternehmens-Abo – ${plan.name}`,
      description: `Bis zu ${plan.maxDrivers} Fahrer, unbegrenzte Fahrten, keine Provision je Fahrt.`,
      metadata: { planId: plan.id, maxDrivers: String(plan.maxDrivers) },
    });
    const price = await client.prices.create({
      product: product.id,
      currency: "eur",
      unit_amount: Math.round(plan.monthlyPrice * 100),
      recurring: { interval: "month" },
      lookup_key: lookupKey,
      metadata: { planId: plan.id },
    });
    return price.id;
  } catch (e: any) {
    console.error("Stripe-Preis konnte nicht angelegt werden:", e?.message);
    return null;
  }
}

// Stripe-Kunden des UNTERNEHMENS sicherstellen (getrennt vom Fahrgast-Kunden).
async function ensureCompanyCustomer(client: StripeLike, companyId: string): Promise<string | null> {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, email: true, phone: true, stripeCustomerId: true },
  });
  if (!c) return null;
  if (c.stripeCustomerId) return c.stripeCustomerId;
  try {
    const cus = await client.customers.create({
      name: c.name,
      email: c.email,
      phone: c.phone ?? undefined,
      metadata: { companyId: c.id, kind: "taxios_subscription" },
    });
    await prisma.company.update({ where: { id: c.id }, data: { stripeCustomerId: cus.id } });
    return cus.id;
  } catch (e: any) {
    console.error("Stripe-Kunde (Firma) fehlgeschlagen:", e?.message);
    return null;
  }
}

/**
 * Abo abschließen: liefert die Stripe-Checkout-URL.
 * Der Betreiber zahlt dort mit Karte oder SEPA-Lastschrift.
 */
export async function createSubscriptionCheckout(
  companyId: string,
  planId: string,
): Promise<{ ok: boolean; url?: string | null; error?: string }> {
  const client = await getClient();
  if (!client) return { ok: false, error: "Stripe ist nicht konfiguriert." };

  const plan = getPlan(planId);
  const customerId = await ensureCompanyCustomer(client, companyId);
  if (!customerId) return { ok: false, error: "Zahlungskonto konnte nicht vorbereitet werden." };
  const priceId = await ensurePrice(client, plan);
  if (!priceId) return { ok: false, error: "Tarif konnte nicht vorbereitet werden." };

  try {
    const session = await client.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // SEPA ist fuer wiederkehrende Zahlungen in DE ueblich und guenstiger.
      payment_method_types: ["card", "sepa_debit"],
      locale: "de",
      success_url: `${baseUrl()}/admin/abo?erfolg=1`,
      cancel_url: `${baseUrl()}/admin/abo?abbruch=1`,
      subscription_data: { metadata: { companyId, planId: plan.id } },
      metadata: { companyId, planId: plan.id, kind: "taxios_subscription" },
    });
    return { ok: true, url: session.url };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Abo konnte nicht gestartet werden." };
  }
}

/**
 * Stripe-Kundenportal: Tarif wechseln, Zahlungsmittel aendern, Rechnungen,
 * Kuendigung – alles von Stripe gehostet.
 */
export async function createBillingPortal(companyId: string): Promise<{ ok: boolean; url?: string | null; error?: string }> {
  const client = await getClient();
  if (!client) return { ok: false, error: "Stripe ist nicht konfiguriert." };
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { stripeCustomerId: true } });
  if (!c?.stripeCustomerId) return { ok: false, error: "Es besteht noch kein Abo." };
  try {
    const portal = await client.billingPortal.sessions.create({
      customer: c.stripeCustomerId,
      return_url: `${baseUrl()}/admin/abo`,
      locale: "de",
    });
    return { ok: true, url: portal.url };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Kundenportal nicht verfügbar." };
  }
}

/**
 * Abo-Zustand aus Stripe uebernehmen. Wird vom Webhook und beim Oeffnen der
 * Abo-Seite aufgerufen, damit der lokale Stand nie veraltet.
 */
export async function syncSubscription(companyId: string): Promise<void> {
  const client = await getClient();
  if (!client) return;
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { stripeCustomerId: true, stripeSubscriptionId: true },
  });
  if (!c?.stripeCustomerId) return;

  try {
    let sub: any = null;
    if (c.stripeSubscriptionId) {
      sub = await client.subscriptions.retrieve(c.stripeSubscriptionId).catch(() => null);
    }
    if (!sub) {
      const list = await client.subscriptions.list({ customer: c.stripeCustomerId, status: "all", limit: 5 });
      // Aktivstes Abo gewinnt.
      sub =
        list.data.find((s: any) => ["active", "trialing", "past_due"].includes(s.status)) ??
        list.data[0] ??
        null;
    }
    if (!sub) return;
    await applySubscription(companyId, sub);
  } catch (e: any) {
    console.error("Abo-Abgleich fehlgeschlagen:", e?.message);
  }
}

// Ein Stripe-Abo auf die Firma anwenden (Tarif + Status + Laufzeit).
export async function applySubscription(companyId: string, sub: any): Promise<void> {
  const priceId: string | undefined = sub.items?.data?.[0]?.price?.id;
  const amount: number | undefined = sub.items?.data?.[0]?.price?.unit_amount;
  // Tarif zuerst aus den Metadaten, sonst ueber den Betrag zuordnen.
  let planId: string | undefined = sub.metadata?.planId ?? sub.items?.data?.[0]?.price?.metadata?.planId;
  if (!planId && amount != null) {
    planId = PLANS.find((p) => Math.round(p.monthlyPrice * 100) === amount)?.id;
  }

  await prisma.company.update({
    where: { id: companyId },
    data: {
      stripeSubscriptionId: sub.id,
      subscriptionStatus: mapStripeStatus(sub.status),
      subscriptionUntil: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      ...(planId ? { plan: planId } : {}),
    },
  });
  void priceId;
}

// Firma zu einem Stripe-Kunden finden (fuer Webhook-Ereignisse).
export async function companyIdForCustomer(stripeCustomerId: string): Promise<string | null> {
  const c = await prisma.company.findFirst({ where: { stripeCustomerId }, select: { id: true } });
  return c?.id ?? null;
}

// Rechnungen des Abos (aus Stripe, nicht lokal gespiegelt).
export async function listSubscriptionInvoices(companyId: string, limit = 12) {
  const client = await getClient();
  if (!client) return [];
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { stripeCustomerId: true } });
  if (!c?.stripeCustomerId) return [];
  try {
    const inv = await client.invoices.list({ customer: c.stripeCustomerId, limit });
    return inv.data.map((i: any) => ({
      id: i.id,
      number: i.number,
      status: i.status, // paid | open | uncollectible | void
      amount: (i.amount_due ?? 0) / 100,
      paidAt: i.status_transitions?.paid_at ? new Date(i.status_transitions.paid_at * 1000) : null,
      periodStart: i.period_start ? new Date(i.period_start * 1000) : null,
      periodEnd: i.period_end ? new Date(i.period_end * 1000) : null,
      pdfUrl: i.invoice_pdf ?? null,
      hostedUrl: i.hosted_invoice_url ?? null,
    }));
  } catch {
    return [];
  }
}
