// Endabrechnung einer Kartenfahrt – ausschliesslich NACH Fahrtende.
//
// Ablauf (Punkt 8-14 des Zahlungsablaufs):
//   Fahrt beendet -> Trinkgeld-Fenster offen (tipPromptedAt gesetzt)
//   -> Kunde waehlt Trinkgeld ODER waehlt "ohne Trinkgeld"
//   -> settleRide() bucht Fahrpreis + Trinkgeld von der gespeicherten Karte ab
//   -> Geld geht als Destination-Charge direkt an das Taxiunternehmen (0 % Provision)
//
// Reagiert der Kunde nicht innerhalb von TIP_WINDOW_MS, bucht der Scheduler
// automatisch den Fahrpreis OHNE Trinkgeld ab (settleDueRides).

import { prisma } from "./prisma";
import { chargeSavedCard, holdOnSavedCard, capturePayment, voidPayment, retrieveIntent } from "./stripe";
import { cardIsExpired } from "./customerCards";

// Zeitfenster fuer die Trinkgeld-Auswahl nach Fahrtende.
export const TIP_WINDOW_MS = Number(process.env.TIP_WINDOW_MS ?? 2 * 60_000);

// Wie lange eine laufende Belastung die Fahrt blockiert, bevor sie als
// verwaist gilt (Serverabsturz mitten in der Zahlung).
const SETTLE_LOCK_MS = Number(process.env.SETTLE_LOCK_MS ?? 90_000);

// Sicherheitsaufschlag auf die Preisschaetzung: Umwege, Wartezeit, Trinkgeld.
const HOLD_BUFFER = Number(process.env.HOLD_BUFFER_PCT ?? 30) / 100;
const HOLD_MIN = Number(process.env.HOLD_MIN_EUR ?? 15);

/**
 * Zahlungsfaehigkeit pruefen, sobald die Fahrt LIVE geht.
 *
 * Genau der Moment aus Punkt 7: nicht beim Buchen (dann waere bei
 * Vorbestellungen tagelang Geld blockiert), sondern wenn der Fahrer losfaehrt.
 * Der geschaetzte Betrag wird bei der Bank reserviert – dadurch ist bewiesen,
 * dass die Karte gueltig UND gedeckt ist, bevor der Gast einsteigt.
 *
 * Schlaegt es fehl, steht die Fahrt sofort auf "Zahlung fehlgeschlagen"; der
 * Kunde kann eine andere Karte waehlen oder auf Bar wechseln, und die Zentrale
 * sieht es, BEVOR gefahren wurde.
 */
export async function prepareRidePayment(bookingId: string): Promise<{
  ok: boolean;
  skipped?: boolean;
  authorized?: number;
  error?: string;
  code?: string;
}> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { card: true, company: true },
  });
  if (!b || b.paymentMethod !== "CARD") return { ok: true, skipped: true };
  if (b.paymentStatus === "BEZAHLT" || b.paymentStatus === "STORNIERT") return { ok: true, skipped: true };
  // Schon geprueft – nicht doppelt reservieren.
  if (b.paymentRef && (b.priceAuthorized ?? 0) > 0) return { ok: true, skipped: true, authorized: b.priceAuthorized ?? 0 };

  const estimate = b.priceExact ?? b.priceMax ?? b.priceApprox ?? b.fare ?? 0;
  const amount = Math.max(HOLD_MIN, Math.round(estimate * (1 + HOLD_BUFFER) * 100) / 100);

  if (!b.card) return failPrepare(b.id, "Für diese Fahrt ist keine Karte hinterlegt.", "NO_CARD");
  if (cardIsExpired(b.card.expMonth, b.card.expYear)) {
    return failPrepare(b.id, "Ihre Karte ist abgelaufen.", "expired_card");
  }
  const stripeCustomerId = b.customerId
    ? (await prisma.customer.findUnique({ where: { id: b.customerId }, select: { stripeCustomerId: true } }))
        ?.stripeCustomerId ?? null
    : null;
  if (!stripeCustomerId) return failPrepare(b.id, "Zahlungskonto nicht gefunden.", "NO_CUSTOMER");

  const destination =
    b.company?.stripeAccountId && b.company.stripeChargesEnabled ? b.company.stripeAccountId : null;

  const hold = await holdOnSavedCard({
    stripeCustomerId,
    paymentMethodId: b.card.stripePaymentMethodId,
    amountEur: amount,
    destinationAccountId: destination,
    metadata: { bookingId: b.id, kind: "ride_hold", estimate: String(estimate) },
  });

  if (!hold.ok) {
    return failPrepare(
      b.id,
      hold.error ?? "Die Karte wurde von der Bank abgelehnt.",
      hold.code ?? "hold_failed",
    );
  }

  // WICHTIG: Zwischen Start und Antwort von Stripe vergeht rund eine Sekunde.
  // In dieser Zeit kann die Fahrt storniert oder beendet worden sein. Das
  // Ergebnis darf dann NICHT mehr zurueckgeschrieben werden – sonst stuende
  // eine stornierte Fahrt wieder auf "Karte hinterlegt", und das Geld des
  // Kunden bliebe reserviert. Wird nicht mehr gebraucht: sofort freigeben.
  const noch = await prisma.booking.updateMany({
    where: {
      id: b.id,
      status: { notIn: ["STORNIERT", "ABGESCHLOSSEN"] },
      paymentStatus: { in: ["KARTE_HINTERLEGT", "FEHLGESCHLAGEN"] },
    },
    data: {
      paymentRef: hold.ref,
      priceAuthorized: hold.amount ?? amount,
      paymentStatus: "KARTE_HINTERLEGT",
      paymentError: null,
    },
  });
  if (noch.count === 0) {
    await voidPayment(hold.ref).catch(() => null);
    return { ok: true, skipped: true };
  }
  return { ok: true, authorized: hold.amount ?? amount };
}

async function failPrepare(bookingId: string, message: string, code: string) {
  // Ebenfalls nur, solange die Fahrt noch laeuft (siehe oben).
  await prisma.booking.updateMany({
    where: {
      id: bookingId,
      status: { notIn: ["STORNIERT", "ABGESCHLOSSEN"] },
      paymentStatus: { in: ["KARTE_HINTERLEGT", "FEHLGESCHLAGEN"] },
    },
    data: { paymentStatus: "FEHLGESCHLAGEN", paymentError: message, priceAuthorized: null },
  });
  return { ok: false, error: message, code };
}

/** Reservierten Betrag freigeben (Storno, oder wenn doch anders bezahlt wird). */
export async function releaseHold(bookingId: string): Promise<boolean> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { paymentRef: true, priceAuthorized: true, paymentStatus: true },
  });
  if (!b?.paymentRef || !((b.priceAuthorized ?? 0) > 0)) return false;
  if (b.paymentStatus === "BEZAHLT") return false;
  const res = await voidPayment(b.paymentRef);
  await prisma.booking.update({
    where: { id: bookingId },
    data: { priceAuthorized: null, paymentRef: null },
  });
  return res.ok;
}

export interface SettleResult {
  ok: boolean;
  status: "BEZAHLT" | "FEHLGESCHLAGEN" | "UEBERSPRUNGEN";
  amount?: number;
  fare?: number;
  tip?: number;
  error?: string;
  code?: string;
}

// Maximales Trinkgeld: 100 % des Fahrpreises, mindestens 50 €.
export function capTip(fare: number, tip: number): number {
  if (!Number.isFinite(tip) || tip <= 0) return 0;
  const cap = Math.max(50, fare);
  return Math.round(Math.min(tip, cap) * 100) / 100;
}

/**
 * Bucht eine beendete Kartenfahrt endgueltig ab.
 * `tip` ist das vom Kunden gewaehlte Trinkgeld (0 = ausdruecklich ohne).
 */
export async function settleRide(bookingId: string, tip = 0): Promise<SettleResult> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { card: true, company: true },
  });
  if (!b) return { ok: false, status: "UEBERSPRUNGEN", error: "Fahrt nicht gefunden." };

  // Nur beendete Kartenfahrten, die noch nicht bezahlt sind.
  if (b.paymentMethod !== "CARD") return { ok: true, status: "UEBERSPRUNGEN", error: "Keine Kartenzahlung." };
  if (b.paymentStatus === "BEZAHLT") {
    return { ok: true, status: "BEZAHLT", amount: (b.fare ?? 0) + (b.tip ?? 0), fare: b.fare ?? 0, tip: b.tip ?? 0 };
  }
  if (b.status !== "ABGESCHLOSSEN") {
    return { ok: false, status: "UEBERSPRUNGEN", error: "Die Fahrt ist noch nicht beendet." };
  }

  const fare = Math.round((b.fare ?? 0) * 100) / 100;
  const finalTip = capTip(fare, tip);
  const total = Math.round((fare + finalTip) * 100) / 100;

  // Doppelbuchungs-Sperre.
  //
  // Der Zaehler allein reicht NICHT: waehrend der rund einen Sekunde, die die
  // Belastung bei Stripe dauert, steht die Fahrt weiter auf "Karte hinterlegt".
  // Ein zweiter Lauf (z. B. die automatische Abrechnung) liest dann den bereits
  // erhoehten Zaehler, kommt durch und belastet ein zweites Mal. Genau das ist
  // passiert: das Geld war eingezogen, der zweite Versuch lief auf einen
  // Stripe-Fehler und markierte die Fahrt faelschlich als "Zahlung offen".
  //
  // Deshalb wird die Fahrt fuer die Dauer der Belastung als belegt markiert.
  // Ein Eintrag aelter als SETTLE_LOCK_MS gilt als verwaist (Serverabsturz).
  const stale = new Date(Date.now() - SETTLE_LOCK_MS);
  const lock = await prisma.booking.updateMany({
    where: {
      id: b.id,
      paymentAttempts: b.paymentAttempts,
      paymentStatus: { in: ["KARTE_HINTERLEGT", "FEHLGESCHLAGEN"] },
      OR: [{ settlingAt: null }, { settlingAt: { lt: stale } }],
    },
    data: { paymentAttempts: { increment: 1 }, tipPromptedAt: null, settlingAt: new Date() },
  });
  if (lock.count === 0) {
    return { ok: false, status: "UEBERSPRUNGEN", error: "Die Zahlung wird bereits verarbeitet." };
  }

  // Karte pruefen, bevor Stripe gerufen wird.
  if (!b.card) {
    return failPayment(b.id, "Für diese Fahrt ist keine Karte hinterlegt.", "NO_CARD", finalTip);
  }
  if (cardIsExpired(b.card.expMonth, b.card.expYear)) {
    return failPayment(b.id, "Ihre Karte ist abgelaufen.", "expired_card", finalTip);
  }
  const stripeCustomerId = b.customerId
    ? (await prisma.customer.findUnique({ where: { id: b.customerId }, select: { stripeCustomerId: true } }))
        ?.stripeCustomerId ?? null
    : null;
  if (!stripeCustomerId) {
    return failPayment(b.id, "Zahlungskonto nicht gefunden.", "NO_CUSTOMER", finalTip);
  }

  // Geld geht direkt an das Taxiunternehmen, sofern dessen Konto freigeschaltet ist.
  const destination =
    b.company?.stripeAccountId && b.company.stripeChargesEnabled ? b.company.stripeAccountId : null;

  // Wurde beim Fahrtstart bereits reserviert, wird GENAU der Endbetrag daraus
  // eingezogen; der Rest der Reservierung verfaellt sofort. Der Kunde sieht nie
  // mehr als den tatsaechlichen Preis auf seiner Abrechnung.
  const held = b.priceAuthorized ?? 0;
  if (b.paymentRef && held > 0 && total <= held) {
    const cap = await capturePayment(b.paymentRef, total);
    if (!cap.ok) {
      // Bevor der Kunde eine Fehlermeldung sieht: bei Stripe nachsehen, ob das
      // Geld nicht doch schon eingezogen wurde. Sonst stuende eine bezahlte
      // Fahrt als "Zahlung offen" da – der schlimmste aller Faelle.
      const echt = await intentSettled(b.paymentRef, total);
      if (!echt) {
        return failPayment(b.id, cap.error ?? "Die Zahlung konnte nicht abgeschlossen werden.", "capture_failed", finalTip);
      }
    }
    await prisma.booking.update({
      where: { id: b.id },
      data: { tip: finalTip, paymentStatus: "BEZAHLT", paymentError: null, tipPromptedAt: null, settlingAt: null },
    });
    return { ok: true, status: "BEZAHLT", amount: total, fare, tip: finalTip };
  }
  // Endbetrag hoeher als reserviert (langer Umweg, grosses Trinkgeld):
  // Reservierung freigeben und den vollen Betrag am Stueck belasten.
  if (b.paymentRef && held > 0) {
    await voidPayment(b.paymentRef).catch(() => null);
  }

  const charge = await chargeSavedCard({
    stripeCustomerId,
    paymentMethodId: b.card.stripePaymentMethodId,
    amountEur: total,
    destinationAccountId: destination,
    metadata: { bookingId: b.id, kind: "taxi_ride", fare: String(fare), tip: String(finalTip) },
  });

  if (!charge.ok) {
    return failPayment(b.id, charge.error ?? "Die Zahlung konnte nicht durchgeführt werden.", charge.code ?? "charge_failed", finalTip);
  }

  await prisma.booking.update({
    where: { id: b.id },
    data: {
      tip: finalTip,
      paymentStatus: "BEZAHLT",
      paymentRef: charge.paymentIntentId,
      paymentError: null,
      tipPromptedAt: null,
      settlingAt: null,
    },
  });
  return { ok: true, status: "BEZAHLT", amount: total, fare, tip: finalTip };
}

/** Hat Stripe den Betrag doch schon eingezogen? Schutz vor Fehlanzeigen. */
async function intentSettled(ref: string, total: number): Promise<boolean> {
  const pi = await retrieveIntent(ref).catch(() => null);
  if (!pi) return false;
  const erhalten = (pi.amount_received ?? 0) / 100;
  return pi.status === "succeeded" && erhalten + 0.005 >= total;
}

// Fehlgeschlagene Belastung festhalten: Fahrt gilt NICHT als bezahlt.
async function failPayment(bookingId: string, message: string, code: string, tip: number): Promise<SettleResult> {
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      tip,
      paymentStatus: "FEHLGESCHLAGEN",
      paymentError: message,
      // Fenster schliessen: der Kunde muss jetzt aktiv eine Karte waehlen.
      tipPromptedAt: null,
      settlingAt: null,
    },
  });
  return { ok: false, status: "FEHLGESCHLAGEN", error: message, code };
}

/**
 * Automatische Abrechnung ohne Trinkgeld fuer Fahrten, bei denen der Kunde
 * nicht reagiert hat (Punkt 13). Wird vom Scheduler regelmaessig aufgerufen.
 */
export async function settleDueRides(): Promise<number> {
  const due = await prisma.booking.findMany({
    where: {
      paymentMethod: "CARD",
      status: "ABGESCHLOSSEN",
      paymentStatus: "KARTE_HINTERLEGT",
      tipPromptedAt: { not: null, lte: new Date(Date.now() - TIP_WINDOW_MS) },
      // Fahrten, bei denen gerade eine Belastung laeuft, auslassen.
      OR: [{ settlingAt: null }, { settlingAt: { lt: new Date(Date.now() - SETTLE_LOCK_MS) } }],
    },
    select: { id: true },
    take: 50,
  });

  let settled = 0;
  for (const b of due) {
    // settleRide sperrt selbst (paymentAttempts) – parallele Laeufe koennen
    // dieselbe Fahrt daher nicht doppelt belasten.
    const res = await settleRide(b.id, 0).catch(() => null);
    if (res?.ok) settled++;
  }
  return settled;
}

/**
 * Storno-/No-Show-Gebuehr bei einer Kartenfahrt abbuchen.
 * Ohne Gebuehr gibt es nichts zu belasten – die vorgemerkte Karte wird
 * einfach freigegeben (es existiert kein Hold, der aufgeloest werden muesste).
 */
export async function chargeCancellationFee(bookingId: string, fee: number): Promise<"BEZAHLT" | "FEHLGESCHLAGEN" | "STORNIERT"> {
  const b = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { card: true, company: true },
  });
  if (!b || b.paymentMethod !== "CARD") return "STORNIERT";
  if (b.paymentStatus === "BEZAHLT") return "BEZAHLT";

  if (!(fee > 0)) {
    // Ohne Gebuehr: eine eventuelle Reservierung sofort wieder freigeben.
    if (b.paymentRef && (b.priceAuthorized ?? 0) > 0) await voidPayment(b.paymentRef).catch(() => null);
    await prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: "STORNIERT", tipPromptedAt: null, settlingAt: null, priceAuthorized: null, paymentRef: null },
    });
    return "STORNIERT";
  }

  // Reservierung vorhanden -> Gebuehr daraus einziehen, Rest verfaellt.
  const gebuehr = Math.round(fee * 100) / 100;
  if (b.paymentRef && (b.priceAuthorized ?? 0) >= gebuehr) {
    const cap = await capturePayment(b.paymentRef, gebuehr);
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: cap.ok ? "BEZAHLT" : "FEHLGESCHLAGEN",
        paymentError: cap.ok ? null : cap.error ?? "Die Gebühr konnte nicht abgebucht werden.",
        paymentAttempts: { increment: 1 },
        tipPromptedAt: null,
        settlingAt: null,
      },
    });
    return cap.ok ? "BEZAHLT" : "FEHLGESCHLAGEN";
  }

  const stripeCustomerId = b.customerId
    ? (await prisma.customer.findUnique({ where: { id: b.customerId }, select: { stripeCustomerId: true } }))
        ?.stripeCustomerId ?? null
    : null;
  if (!b.card || !stripeCustomerId || cardIsExpired(b.card.expMonth, b.card.expYear)) {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: "FEHLGESCHLAGEN", paymentError: "Die Gebühr konnte nicht abgebucht werden.", tipPromptedAt: null, settlingAt: null },
    });
    return "FEHLGESCHLAGEN";
  }

  const destination = b.company?.stripeAccountId && b.company.stripeChargesEnabled ? b.company.stripeAccountId : null;
  const charge = await chargeSavedCard({
    stripeCustomerId,
    paymentMethodId: b.card.stripePaymentMethodId,
    amountEur: Math.round(fee * 100) / 100,
    destinationAccountId: destination,
    metadata: { bookingId: b.id, kind: "cancellation_fee" },
  });

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      paymentStatus: charge.ok ? "BEZAHLT" : "FEHLGESCHLAGEN",
      paymentRef: charge.paymentIntentId ?? b.paymentRef,
      paymentError: charge.ok ? null : charge.error ?? "Die Gebühr konnte nicht abgebucht werden.",
      paymentAttempts: { increment: 1 },
      tipPromptedAt: null,
      settlingAt: null,
    },
  });
  return charge.ok ? "BEZAHLT" : "FEHLGESCHLAGEN";
}
