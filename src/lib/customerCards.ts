// Gespeicherte Kundenkarten – gemeinsame Logik fuer API-Routen und Dispatch.
//
// Grundsatz: Kartendaten liegen ausschliesslich bei Stripe. Lokal steht nur die
// Referenz (`stripePaymentMethodId`) plus Anzeigedaten (Marke, letzte 4 Ziffern,
// Ablaufdatum) – genug fuer die Auswahl im Konto, ohne je eine Kartennummer
// zu speichern.

import { prisma } from "./prisma";
import { createStripeCustomer, getCardInfo, detachCard } from "./stripe";

export interface CardDTO {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  expired: boolean;
  label: string; // "Visa •••• 4242"
}

const BRAND_LABEL: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

export function cardIsExpired(expMonth: number, expYear: number): boolean {
  const now = new Date();
  // Eine Karte gilt bis zum Ende ihres Ablaufmonats.
  const end = new Date(expYear, expMonth, 1);
  return end.getTime() <= now.getTime();
}

export function cardDTO(c: {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}): CardDTO {
  const brand = BRAND_LABEL[c.brand] ?? c.brand.charAt(0).toUpperCase() + c.brand.slice(1);
  return {
    id: c.id,
    brand,
    last4: c.last4,
    expMonth: c.expMonth,
    expYear: c.expYear,
    isDefault: c.isDefault,
    expired: cardIsExpired(c.expMonth, c.expYear),
    label: `${brand} •••• ${c.last4}`,
  };
}

// Stripe-Kunden fuer ein Kundenkonto sicherstellen (einmalig anlegen).
export async function ensureStripeCustomer(customerId: string): Promise<string | null> {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, email: true, name: true, phone: true, stripeCustomerId: true },
  });
  if (!c) return null;
  if (c.stripeCustomerId) return c.stripeCustomerId;

  const created = await createStripeCustomer(
    { email: c.email, name: c.name, phone: c.phone },
    { customerId: c.id },
  );
  if (!created.ok || !created.customerId) return null;
  await prisma.customer.update({ where: { id: c.id }, data: { stripeCustomerId: created.customerId } });
  return created.customerId;
}

// Karten eines Kunden (Standardkarte zuerst).
export async function listCards(customerId: string): Promise<CardDTO[]> {
  const cards = await prisma.customerCard.findMany({
    where: { customerId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return cards.map(cardDTO);
}

// Nach erfolgreichem SetupIntent die Karte lokal spiegeln.
// Die erste Karte wird automatisch Standardkarte.
export async function saveCard(customerId: string, paymentMethodId: string): Promise<CardDTO | null> {
  const existing = await prisma.customerCard.findUnique({ where: { stripePaymentMethodId: paymentMethodId } });
  if (existing) return cardDTO(existing);

  const info = await getCardInfo(paymentMethodId);
  if (!info) return null;

  const count = await prisma.customerCard.count({ where: { customerId } });
  const card = await prisma.customerCard.create({
    data: {
      customerId,
      stripePaymentMethodId: info.paymentMethodId,
      brand: info.brand,
      last4: info.last4,
      expMonth: info.expMonth,
      expYear: info.expYear,
      isDefault: count === 0,
    },
  });
  return cardDTO(card);
}

// Standardkarte setzen (genau eine je Kunde).
export async function setDefaultCard(customerId: string, cardId: string): Promise<boolean> {
  const card = await prisma.customerCard.findFirst({ where: { id: cardId, customerId } });
  if (!card) return false;
  await prisma.$transaction([
    prisma.customerCard.updateMany({ where: { customerId }, data: { isDefault: false } }),
    prisma.customerCard.update({ where: { id: cardId }, data: { isDefault: true } }),
  ]);
  return true;
}

// Karte entfernen. Rueckt bei Bedarf eine andere als Standardkarte nach.
export async function removeCard(customerId: string, cardId: string): Promise<{ ok: boolean; reason?: string }> {
  const card = await prisma.customerCard.findFirst({ where: { id: cardId, customerId } });
  if (!card) return { ok: false, reason: "Karte nicht gefunden." };

  // Karten, die fuer eine noch offene Fahrt gebraucht werden, nicht loeschen.
  const inUse = await prisma.booking.count({
    where: {
      cardId,
      paymentMethod: "CARD",
      paymentStatus: { notIn: ["BEZAHLT", "STORNIERT"] },
      status: { notIn: ["STORNIERT"] },
    },
  });
  if (inUse > 0) {
    return { ok: false, reason: "Diese Karte wird noch für eine offene Fahrt benötigt." };
  }

  await detachCard(card.stripePaymentMethodId);
  await prisma.customerCard.delete({ where: { id: cardId } });

  if (card.isDefault) {
    const next = await prisma.customerCard.findFirst({ where: { customerId }, orderBy: { createdAt: "desc" } });
    if (next) await prisma.customerCard.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  return { ok: true };
}

// Die fuer eine Fahrt zu verwendende Karte bestimmen:
// ausdruecklich gewaehlte Karte, sonst die Standardkarte.
export async function resolveCardForBooking(
  customerId: string,
  requestedCardId?: string | null,
): Promise<{ card: { id: string; stripePaymentMethodId: string; expMonth: number; expYear: number } | null; error?: string }> {
  if (requestedCardId) {
    const c = await prisma.customerCard.findFirst({ where: { id: requestedCardId, customerId } });
    if (!c) return { card: null, error: "Die gewählte Karte gehört nicht zu Ihrem Konto." };
    if (cardIsExpired(c.expMonth, c.expYear)) return { card: null, error: "Die gewählte Karte ist abgelaufen." };
    return { card: c };
  }
  const def = await prisma.customerCard.findFirst({
    where: { customerId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  if (!def) return { card: null, error: "Bitte hinterlegen Sie zuerst eine Zahlungskarte." };
  if (cardIsExpired(def.expMonth, def.expYear)) {
    return { card: null, error: "Ihre hinterlegte Karte ist abgelaufen. Bitte fügen Sie eine neue Karte hinzu." };
  }
  return { card: def };
}
