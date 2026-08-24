import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  createConnectAccount,
  createAccountLink,
  getConnectStatus,
  createLoginLink,
  paymentEnabled,
} from "@/lib/stripe";
import { getPlan } from "@/lib/plans";

export const dynamic = "force-dynamic";

function baseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// Status des eigenen Auszahlungskontos (Stripe Connect) + Abo-Infos.
export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
    select: {
      stripeAccountId: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      plan: true,
      subscriptionStatus: true,
      subscriptionUntil: true,
    },
  });
  if (!company) return NextResponse.json({ error: "Firma nicht gefunden" }, { status: 404 });

  const status = await getConnectStatus(company.stripeAccountId);
  // Freischaltstatus lokal spiegeln, damit der Buchungs-Flow ihn ohne
  // Stripe-Roundtrip pruefen kann.
  if (
    company.stripeAccountId &&
    (status.chargesEnabled !== company.stripeChargesEnabled ||
      status.payoutsEnabled !== company.stripePayoutsEnabled)
  ) {
    await prisma.company.update({
      where: { id: session.companyId },
      data: { stripeChargesEnabled: status.chargesEnabled, stripePayoutsEnabled: status.payoutsEnabled },
    });
  }

  const plan = getPlan(company.plan);
  const driverCount = await prisma.driver.count({ where: { companyId: session.companyId } });

  return NextResponse.json({
    stripeConfigured: paymentEnabled(),
    connect: status,
    dashboardUrl: company.stripeAccountId ? await createLoginLink(company.stripeAccountId) : null,
    subscription: {
      plan: plan.id,
      planName: plan.name,
      maxDrivers: plan.maxDrivers,
      monthlyPrice: plan.monthlyPrice,
      status: company.subscriptionStatus,
      until: company.subscriptionUntil,
      driverCount,
    },
    // Kernaussage fuers UI: die Plattform behaelt nichts ein.
    commissionPercent: 0,
  });
}

// Onboarding starten bzw. fortsetzen -> liefert die Stripe-URL.
export async function POST() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  if (!paymentEnabled()) {
    return NextResponse.json({ error: "Stripe ist nicht konfiguriert (STRIPE_SECRET_KEY fehlt)." }, { status: 400 });
  }

  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
    select: { id: true, name: true, email: true, stripeAccountId: true },
  });
  if (!company) return NextResponse.json({ error: "Firma nicht gefunden" }, { status: 404 });

  let accountId = company.stripeAccountId;
  if (!accountId) {
    const created = await createConnectAccount(company.email, company.name, { companyId: company.id });
    if (!created.ok || !created.accountId) {
      return NextResponse.json({ error: created.error ?? "Konto konnte nicht angelegt werden." }, { status: 502 });
    }
    accountId = created.accountId;
    await prisma.company.update({ where: { id: company.id }, data: { stripeAccountId: accountId } });
  }

  const base = baseUrl();
  const link = await createAccountLink(
    accountId,
    `${base}/admin/auszahlung?refresh=1`,
    `${base}/admin/auszahlung?return=1`,
  );
  if (!link.ok || !link.url) {
    return NextResponse.json({ error: link.error ?? "Onboarding-Link fehlgeschlagen." }, { status: 502 });
  }
  return NextResponse.json({ url: link.url, accountId, mock: link.mock });
}
