// Pruefung vor JEDER Buchung (Punkt 1 des Zahlungsablaufs).
//
// Reihenfolge der Pruefungen:
//   1. Bei Kartenzahlung: Kunde muss angemeldet sein (Karten haengen am Konto).
//   2. Konto darf nicht gesperrt sein.
//   3. Telefonnummer muss bestaetigt sein (Konto-Nummer oder Verifizierungs-Token).
//   4. Zahlungsart muss eindeutig sein: BAR oder KARTE.
//   5. Bei Karte: es muss eine gueltige (nicht abgelaufene) Karte hinterlegt sein.
//
// Erst wenn alles zutrifft, darf die Buchung angelegt werden.

import { prisma } from "./prisma";
import { resolveCardForBooking } from "./customerCards";

export type PayMethod = "CASH" | "CARD" | "FIRMA";

export interface GuardOk {
  ok: true;
  paymentMethod: PayMethod;
  // Nur bei Kartenzahlung gesetzt.
  card: { id: string; stripePaymentMethodId: string } | null;
  stripeCustomerId: string | null;
}
export interface GuardFail {
  ok: false;
  status: number;
  error: string;
  code: string;
}
export type GuardResult = GuardOk | GuardFail;

const fail = (status: number, code: string, error: string): GuardFail => ({ ok: false, status, error, code });

export async function checkBookingPreconditions(opts: {
  paymentMethod: PayMethod;
  customerId: string | null;
  phoneVerified: boolean;
  requestedCardId?: string | null;
}): Promise<GuardResult> {
  const { paymentMethod, customerId, phoneVerified, requestedCardId } = opts;

  // Firmenfahrten (Mobilitaets-Code) laufen ueber das Firmenkonto – keine Karte.
  if (paymentMethod === "FIRMA") {
    return { ok: true, paymentMethod, card: null, stripeCustomerId: null };
  }

  // --- 1. Kartenzahlung erfordert ein Kundenkonto -------------------------
  if (paymentMethod === "CARD" && !customerId) {
    return fail(
      401,
      "LOGIN_REQUIRED",
      "Für Kartenzahlung melden Sie sich bitte an. Ihre Karte wird sicher in Ihrem Konto hinterlegt.",
    );
  }

  // --- 2. Kontostatus ------------------------------------------------------
  let stripeCustomerId: string | null = null;
  if (customerId) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { blocked: true, blockedReason: true, stripeCustomerId: true },
    });
    if (!customer) return fail(404, "ACCOUNT_NOT_FOUND", "Ihr Kundenkonto wurde nicht gefunden.");
    if (customer.blocked) {
      return fail(
        403,
        "ACCOUNT_BLOCKED",
        customer.blockedReason ?? "Ihr Konto ist gesperrt. Bitte wenden Sie sich an unsere Zentrale.",
      );
    }
    stripeCustomerId = customer.stripeCustomerId;
  }

  // --- 3. Telefonnummer bestaetigt ----------------------------------------
  if (!phoneVerified) {
    return fail(
      403,
      "VERIFICATION_REQUIRED",
      "Bitte bestätigen Sie zuerst Ihre Telefonnummer mit dem SMS-Code.",
    );
  }

  // --- 4./5. Zahlungsart + hinterlegte Karte ------------------------------
  if (paymentMethod === "CASH") {
    // Barzahlung: keine Karte, kein Stripe-Vorgang.
    return { ok: true, paymentMethod, card: null, stripeCustomerId: null };
  }

  const { card, error } = await resolveCardForBooking(customerId as string, requestedCardId);
  if (!card) {
    return fail(402, "CARD_REQUIRED", error ?? "Bitte hinterlegen Sie eine Zahlungskarte.");
  }
  return {
    ok: true,
    paymentMethod,
    card: { id: card.id, stripePaymentMethodId: card.stripePaymentMethodId },
    stripeCustomerId,
  };
}
