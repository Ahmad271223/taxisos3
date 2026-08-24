import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  paymentEnabled,
  createCardSetupIntent,
  createCardSetupCheckout,
  paymentMethodFromSetupSession,
} from "@/lib/stripe";
import { ensureStripeCustomer, listCards, saveCard } from "@/lib/customerCards";

export const dynamic = "force-dynamic";

function baseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// Alle gespeicherten Karten des angemeldeten Kunden.
export async function GET() {
  const session = requireRole("CUSTOMER");
  if (!session) return NextResponse.json({ error: "Bitte melden Sie sich an." }, { status: 401 });

  const cards = await listCards(session.sub);
  return NextResponse.json({
    cards,
    defaultCardId: cards.find((c) => c.isDefault)?.id ?? null,
    stripeConfigured: paymentEnabled(),
  });
}

/**
 * Neue Karte hinterlegen – Schritt 1.
 *
 * Standardweg ist die von Stripe GEHOSTETE Seite: der Kunde wird
 * weitergeleitet, gibt seine Karte dort ein und kommt zurueck. Dafuer ist
 * KEIN oeffentlicher Stripe-Schluessel im Browser noetig.
 *
 * Ist ein Publishable Key hinterlegt, wird zusaetzlich ein clientSecret
 * geliefert, damit die Eingabe wahlweise direkt in der App erfolgen kann.
 */
export async function POST() {
  const session = requireRole("CUSTOMER");
  if (!session) return NextResponse.json({ error: "Bitte melden Sie sich an." }, { status: 401 });

  const customer = await prisma.customer.findUnique({
    where: { id: session.sub },
    select: { blocked: true, blockedReason: true },
  });
  if (!customer) return NextResponse.json({ error: "Konto nicht gefunden." }, { status: 404 });
  if (customer.blocked) {
    return NextResponse.json(
      { error: customer.blockedReason ?? "Ihr Konto ist gesperrt.", code: "ACCOUNT_BLOCKED" },
      { status: 403 },
    );
  }
  if (!paymentEnabled()) {
    return NextResponse.json(
      { error: "Kartenzahlung ist noch nicht eingerichtet.", code: "STRIPE_MISSING" },
      { status: 400 },
    );
  }

  const stripeCustomerId = await ensureStripeCustomer(session.sub);
  if (!stripeCustomerId) {
    return NextResponse.json({ error: "Zahlungskonto konnte nicht vorbereitet werden." }, { status: 502 });
  }

  const back = `${baseUrl()}/konto?tab=payment`;
  const hosted = await createCardSetupCheckout(stripeCustomerId, back, `${back}&abbruch=1`);
  const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;
  const inline = pk ? await createCardSetupIntent(stripeCustomerId) : null;

  if (!hosted.ok && !inline?.ok) {
    return NextResponse.json({ error: hosted.error ?? "Karte konnte nicht vorbereitet werden." }, { status: 502 });
  }

  return NextResponse.json({
    // Bevorzugter Weg: Weiterleitung zu Stripe.
    url: hosted.url,
    // Optionaler Weg: Eingabe direkt in der App (nur mit Publishable Key).
    clientSecret: inline?.clientSecret ?? null,
    setupIntentId: inline?.setupIntentId ?? null,
    publishableKey: pk,
    mock: hosted.mock,
  });
}

/**
 * Neue Karte hinterlegen – Schritt 2.
 * Entweder mit `sessionId` (Rueckkehr von der Stripe-Seite) oder mit
 * `paymentMethodId` (Eingabe direkt in der App).
 */
export async function PUT(req: Request) {
  const session = requireRole("CUSTOMER");
  if (!session) return NextResponse.json({ error: "Bitte melden Sie sich an." }, { status: 401 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  let paymentMethodId = typeof json?.paymentMethodId === "string" ? json.paymentMethodId.trim() : "";
  const sessionId = typeof json?.sessionId === "string" ? json.sessionId.trim() : "";
  if (!paymentMethodId && sessionId) {
    paymentMethodId = (await paymentMethodFromSetupSession(sessionId)) ?? "";
  }
  if (!paymentMethodId) {
    return NextResponse.json({ error: "Es wurde keine Karte übermittelt." }, { status: 400 });
  }

  // Fremde Zahlungsmethoden nicht uebernehmen.
  const claimed = await prisma.customerCard.findUnique({ where: { stripePaymentMethodId: paymentMethodId } });
  if (claimed && claimed.customerId !== session.sub) {
    return NextResponse.json({ error: "Diese Zahlungsmethode ist bereits vergeben." }, { status: 409 });
  }

  const card = await saveCard(session.sub, paymentMethodId);
  if (!card) return NextResponse.json({ error: "Karte konnte nicht gespeichert werden." }, { status: 502 });
  return NextResponse.json({ card }, { status: 201 });
}
