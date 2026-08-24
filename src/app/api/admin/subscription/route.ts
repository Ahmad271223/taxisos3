import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { PLANS, getPlan, planForDriverCount } from "@/lib/plans";
import {
  subscriptionsEnabled,
  syncSubscription,
  createSubscriptionCheckout,
  createBillingPortal,
  listSubscriptionInvoices,
  SUBSCRIPTION_LABEL,
} from "@/lib/subscription";

export const dynamic = "force-dynamic";

// Aktueller Abo-Zustand + Tarifübersicht + Rechnungen.
export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  // Stand aus Stripe auffrischen, damit die Anzeige nie veraltet ist.
  await syncSubscription(session.companyId).catch(() => {});

  const [company, driverCount] = await Promise.all([
    prisma.company.findUnique({
      where: { id: session.companyId },
      select: {
        plan: true,
        subscriptionStatus: true,
        subscriptionUntil: true,
        stripeSubscriptionId: true,
      },
    }),
    prisma.driver.count({ where: { companyId: session.companyId } }),
  ]);
  if (!company) return NextResponse.json({ error: "Firma nicht gefunden" }, { status: 404 });

  const plan = getPlan(company.plan);
  const needed = planForDriverCount(driverCount);

  return NextResponse.json({
    stripeConfigured: subscriptionsEnabled(),
    subscription: {
      plan: plan.id,
      planName: plan.name,
      maxDrivers: plan.maxDrivers,
      monthlyPrice: plan.monthlyPrice,
      status: company.subscriptionStatus,
      statusLabel: SUBSCRIPTION_LABEL[company.subscriptionStatus] ?? company.subscriptionStatus,
      until: company.subscriptionUntil,
      active: company.subscriptionStatus === "AKTIV",
      hasSubscription: !!company.stripeSubscriptionId,
    },
    driverCount,
    driversLeft: Math.max(0, plan.maxDrivers - driverCount),
    // Falls schon mehr Fahrer angelegt sind, als der Tarif erlaubt.
    recommendedPlan: needed && needed.maxDrivers > plan.maxDrivers ? needed : null,
    plans: PLANS,
    // Klare Trennung: das Abo ist unsere EINZIGE Einnahme.
    commissionPercent: 0,
    invoices: await listSubscriptionInvoices(session.companyId).catch(() => []),
  });
}

// Abo abschließen bzw. Tarif wechseln -> Stripe-Checkout / Kundenportal.
export async function POST(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!subscriptionsEnabled()) {
    return NextResponse.json({ error: "Abrechnung ist noch nicht eingerichtet." }, { status: 400 });
  }

  let json: any = {};
  try {
    json = await req.json();
  } catch {
    /* Body optional */
  }

  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
    select: { stripeSubscriptionId: true },
  });

  // Läuft bereits ein Abo -> Änderungen laufen über das Stripe-Kundenportal
  // (Tarifwechsel, Zahlungsmittel, Kündigung, Rechnungen).
  if (company?.stripeSubscriptionId && json?.action !== "new") {
    const portal = await createBillingPortal(session.companyId);
    if (!portal.ok) return NextResponse.json({ error: portal.error }, { status: 502 });
    return NextResponse.json({ url: portal.url, kind: "portal" });
  }

  const planId = typeof json?.plan === "string" ? json.plan : "P5";
  if (!PLANS.some((p) => p.id === planId)) {
    return NextResponse.json({ error: "Unbekannter Tarif." }, { status: 400 });
  }

  const checkout = await createSubscriptionCheckout(session.companyId, planId);
  if (!checkout.ok) return NextResponse.json({ error: checkout.error }, { status: 502 });
  return NextResponse.json({ url: checkout.url, kind: "checkout" });
}
