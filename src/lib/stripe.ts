// Stripe-Anbindung.
//
// AKTUELLES MODELL (Zahlung nach Fahrtende):
//  1. Karte im Kundenkonto hinterlegen -> createCardSetupIntent() (SetupIntent,
//     usage "off_session"). Es wird NICHTS reserviert und NICHTS abgebucht.
//  2. Buchung -> nur die gewaehlte Karte wird vorgemerkt.
//  3. Fahrtende -> Trinkgeld-Auswahl -> chargeSavedCard(): Fahrpreis + Trinkgeld
//     als Destination-Charge direkt an das Taxiunternehmen (0 % Provision).
//
// Die Hold-Funktionen (createAuthIntent/capturePayment/voidPayment) werden vom
// Buchungs-Flow NICHT mehr verwendet; sie bleiben nur fuer Alt-Buchungen und
// Rueckerstattungen erhalten.
//
// Ohne STRIPE_SECRET_KEY laeuft im TESTBETRIEB ein Ersatzmodus: es werden
// `mock_*`-Referenzen vergeben und keine echten Stripe-Calls abgesetzt, damit
// der Bestell-/Abschluss-Flow auch ohne Schluessel durchlaeuft.
//
// Im ECHTBETRIEB (NODE_ENV=production) ist dieser Ersatzmodus ABGESCHALTET:
// jede Geldfunktion meldet dann einen ehrlichen Fehler statt eines erfundenen
// Erfolgs. Andernfalls stuenden Fahrten als "bezahlt" in der Datenbank, ohne
// dass je Geld geflossen waere.

type StripeLike = any;

let clientPromise: Promise<StripeLike | null> | null = null;

export function paymentEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

async function getClient(): Promise<StripeLike | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!clientPromise) {
    // Dynamischer Import: das `stripe`-Paket wird nur geladen, wenn ein
    // Schluessel gesetzt ist – so bleibt die App ohne installiertes Paket lauffaehig.
    clientPromise = import("stripe")
      .then((m: any) => {
        const Stripe = m.default ?? m;
        return new Stripe(process.env.STRIPE_SECRET_KEY as string);
      })
      .catch((e: any) => {
        // Ohne diese Meldung liefe die App still im Ersatzbetrieb weiter,
        // obwohl ein Schluessel gesetzt ist.
        console.error("Stripe konnte nicht geladen werden:", e?.message ?? e);
        return null;
      });
  }
  return clientPromise;
}

/**
 * Darf ohne echte Stripe-Verbindung ein Erfolg vorgetaeuscht werden?
 *
 * Im Testbetrieb ja – sonst waere die App ohne Schluessel unbenutzbar.
 * Im Echtbetrieb NIEMALS: sonst stuende eine Fahrt als "bezahlt" in der
 * Datenbank, obwohl nie Geld geflossen ist. Dann lieber ein ehrlicher Fehler.
 */
function ersatzbetriebErlaubt(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Einheitliche Antwort, wenn im Echtbetrieb keine Zahlung moeglich ist. */
function keineZahlungMoeglich(ref: string | null = null): PayResult {
  return {
    ok: false,
    ref,
    status: "FEHLGESCHLAGEN",
    mock: false,
    error: "Die Zahlungsanbindung ist nicht verfügbar. Bitte bar bezahlen.",
  };
}

export type PaymentState = "AUTORISIERT" | "BEZAHLT" | "STORNIERT" | "FEHLGESCHLAGEN";

export interface PayResult {
  ok: boolean;
  ref: string | null;
  status: PaymentState;
  mock: boolean;
  error?: string;
}

function mockRef(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

// Stripe-Mindestbetrag ist 0,50 €. Wir runden auf ganze Cent.
function toCents(amountEur: number): number {
  return Math.max(50, Math.round((amountEur || 0) * 100));
}

function isMock(ref: string | null | undefined): boolean {
  // WICHTIG: Ein FEHLENDER Verweis ist kein Ersatzbetrieb, sondern ein Fehler.
  // Vorher galt null als "mock" – dadurch meldete z. B. capturePayment(null)
  // trotz echter Stripe-Verbindung Erfolg, ohne dass Geld geflossen waere.
  return !!ref && ref.startsWith("mock_");
}

// Karten-Hold inkl. Trinkgeld-Puffer (25 %, aufgerundet auf ganze Euro).
// So bleibt bei Fahrtende Spielraum fuer Trinkgeld/Aufrundung, ohne den
// autorisierten Betrag zu ueberschreiten. Der nicht belastete Rest des Holds
// wird nach dem Capture automatisch freigegeben.
export function holdWithTipBuffer(priceMax: number): number {
  const p = priceMax || 0;
  return Math.max(p, Math.ceil(p * 1.25));
}

// Mock-Autorisierung (nur ohne Stripe-Key, z. B. lokal/CI). Der echte Hold
// entsteht clientseitig: createAuthIntent() -> Karteneingabe (Stripe Elements)
// -> confirmPayment() -> Server verifiziert via retrieveIntent().
export async function authorizePayment(
  _amountEur: number,
  _metadata: Record<string, string> = {},
): Promise<PayResult> {
  if (!ersatzbetriebErlaubt()) return keineZahlungMoeglich();
  return { ok: true, ref: mockRef("mock_auth"), status: "AUTORISIERT", mock: true };
}

export interface IntentResult {
  ok: boolean;
  mock: boolean;
  clientSecret: string | null;
  id: string | null;
  amount: number | null; // Cent
  error?: string;
  // true = Geld geht per Destination-Charge direkt an das Firmenkonto.
  usedDestination?: boolean;
}

// PaymentIntent mit manueller Erfassung anlegen (Hold). Wird vom Client mit der
// eingegebenen Karte bestaetigt (confirmPayment) -> Status "requires_capture".
export async function createAuthIntent(
  amountEur: number,
  metadata: Record<string, string> = {},
  // Stripe-Connect-Konto des Taxiunternehmens. Ist es gesetzt, wird der
  // Fahrpreis als Destination-Charge direkt dorthin ueberwiesen – die
  // Plattform behaelt KEINE Provision (application_fee_amount entfaellt).
  destinationAccountId?: string | null,
): Promise<IntentResult> {
  const cents = toCents(amountEur);
  const client = await getClient();
  if (!client) {
    if (!ersatzbetriebErlaubt()) {
      return { ok: false, mock: false, clientSecret: null, id: null, amount: null,
               error: "Die Zahlungsanbindung ist nicht verfügbar." };
    }
    return { ok: true, mock: true, clientSecret: null, id: mockRef("mock_pi"), amount: cents };
  }
  try {
    const pi = await client.paymentIntents.create({
      amount: cents,
      currency: "eur",
      capture_method: "manual",
      payment_method_types: ["card"],
      metadata,
      ...(destinationAccountId
        ? { transfer_data: { destination: destinationAccountId }, on_behalf_of: destinationAccountId }
        : {}),
    });
    return {
      ok: true,
      mock: false,
      clientSecret: pi.client_secret ?? null,
      id: pi.id,
      amount: pi.amount,
      usedDestination: !!destinationAccountId,
    };
  } catch (e: any) {
    // Ist das Firmenkonto (noch) nicht auszahlungsbereit, lehnt Stripe die
    // Destination-Charge ab. Dann NICHT die ganze Zahlung scheitern lassen,
    // sondern ueber das Plattform-Konto abwickeln (Abrechnung dann manuell).
    if (destinationAccountId) {
      console.warn("Stripe: Destination-Charge abgelehnt, Fallback auf Plattform-Konto:", e?.message);
      const fallback = await createAuthIntent(amountEur, metadata, null);
      return { ...fallback, usedDestination: false };
    }
    return { ok: false, mock: false, clientSecret: null, id: null, amount: null, error: e?.message ?? "stripe_error" };
  }
}

// PaymentIntent abrufen (zur serverseitigen Verifizierung beim Buchen).
export async function retrieveIntent(id: string): Promise<any | null> {
  const client = await getClient();
  if (!client) return null;
  try {
    return await client.paymentIntents.retrieve(id);
  } catch {
    return null;
  }
}

// Webhook-Signatur prüfen (benötigt STRIPE_WEBHOOK_SECRET).
export async function constructWebhookEvent(
  rawBody: string,
  signature: string | null,
): Promise<{ ok: boolean; event?: any; error?: string }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const client = await getClient();
  if (!client || !secret || !signature) return { ok: false, error: "webhook_not_configured" };
  try {
    const event = client.webhooks.constructEvent(rawBody, signature, secret);
    return { ok: true, event };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "invalid_signature" };
  }
}

// Autorisierten Betrag belasten. `amountEur` darf die Autorisierung nicht
// uebersteigen – der Aufrufer deckelt ggf. auf den Hold-Betrag.
export async function capturePayment(ref: string | null, amountEur: number): Promise<PayResult> {
  // Ohne Vorgangsnummer gibt es nichts einzuziehen – das ist ein Fehler im
  // Aufrufer und darf nie als Erfolg durchgehen.
  if (!ref) return { ok: false, ref: null, status: "FEHLGESCHLAGEN", mock: false, error: "Kein Zahlungsvorgang hinterlegt." };
  if (isMock(ref)) {
    return { ok: true, ref: ref ?? null, status: "BEZAHLT", mock: true };
  }
  const client = await getClient();
  if (!client) return ersatzbetriebErlaubt() ? { ok: true, ref, status: "BEZAHLT", mock: true } : keineZahlungMoeglich(ref);
  try {
    const pi = await client.paymentIntents.capture(ref as string, {
      amount_to_capture: toCents(amountEur),
    });
    const ok = pi.status === "succeeded";
    return { ok, ref: pi.id, status: ok ? "BEZAHLT" : "FEHLGESCHLAGEN", mock: false, error: ok ? undefined : pi.status };
  } catch (e: any) {
    return { ok: false, ref, status: "FEHLGESCHLAGEN", mock: false, error: e?.message ?? "stripe_error" };
  }
}

// Autorisierung wieder freigeben (Stornierung vor Belastung).
export async function voidPayment(ref: string | null): Promise<PayResult> {
  if (!ref) return { ok: false, ref: null, status: "FEHLGESCHLAGEN", mock: false, error: "Kein Zahlungsvorgang hinterlegt." };
  if (isMock(ref)) {
    return { ok: true, ref: ref ?? null, status: "STORNIERT", mock: true };
  }
  const client = await getClient();
  if (!client) return ersatzbetriebErlaubt() ? { ok: true, ref, status: "STORNIERT", mock: true } : keineZahlungMoeglich(ref);
  try {
    const pi = await client.paymentIntents.cancel(ref as string);
    return { ok: true, ref: pi.id, status: "STORNIERT", mock: false };
  } catch (e: any) {
    return { ok: false, ref, status: "FEHLGESCHLAGEN", mock: false, error: e?.message ?? "stripe_error" };
  }
}

// Rueckerstattung einer bereits belasteten Fahrt (ganz oder teilweise).
// Bei Destination-Charges wird der Transfer an das Unternehmen automatisch
// zurueckgeholt (reverse_transfer), damit die Plattform nicht draufzahlt.
export async function refundPayment(
  ref: string | null,
  amountEur?: number,
): Promise<{ ok: boolean; refundId: string | null; amount: number | null; mock: boolean; error?: string }> {
  if (!ref) return { ok: false, refundId: null, amount: null, mock: false, error: "Kein Zahlungsvorgang hinterlegt." };
  if (isMock(ref)) return { ok: true, refundId: mockRef("mock_re"), amount: amountEur ?? null, mock: true };
  const client = await getClient();
  if (!client) return ersatzbetriebErlaubt()
    ? { ok: true, refundId: null, amount: null, mock: true }
    : { ok: false, refundId: null, amount: null, mock: false, error: "Die Zahlungsanbindung ist nicht verfügbar." };
  try {
    const refund = await client.refunds.create({
      payment_intent: ref as string,
      ...(amountEur != null ? { amount: toCents(amountEur) } : {}),
      reverse_transfer: true,
    });
    return { ok: refund.status === "succeeded" || refund.status === "pending", refundId: refund.id, amount: refund.amount / 100, mock: false };
  } catch (e: any) {
    return { ok: false, refundId: null, amount: null, mock: false, error: e?.message ?? "stripe_error" };
  }
}

// ---------------------------------------------------------------------------
// Stripe Connect: Auszahlungskonto des Taxiunternehmens
// ---------------------------------------------------------------------------

export interface ConnectStatus {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  mock: boolean;
}

// Express-Konto anlegen (einmalig je Unternehmen).
export async function createConnectAccount(
  email: string,
  companyName: string,
  metadata: Record<string, string> = {},
): Promise<{ ok: boolean; accountId: string | null; mock: boolean; error?: string }> {
  const client = await getClient();
  if (!client) return ersatzbetriebErlaubt()
    ? { ok: true, accountId: mockRef("mock_acct"), mock: true }
    : { ok: false, accountId: null, mock: false, error: "Die Zahlungsanbindung ist nicht verfügbar." };
  try {
    const account = await client.accounts.create({
      type: "express",
      country: "DE",
      email,
      business_profile: { name: companyName, mcc: "4121" }, // 4121 = Taxis/Limousines
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata,
    });
    return { ok: true, accountId: account.id, mock: false };
  } catch (e: any) {
    return { ok: false, accountId: null, mock: false, error: e?.message ?? "stripe_error" };
  }
}

// Onboarding-/Nachtrag-Link fuer das Express-Dashboard erzeugen.
export async function createAccountLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string,
): Promise<{ ok: boolean; url: string | null; mock: boolean; error?: string }> {
  const client = await getClient();
  if (!client) return ersatzbetriebErlaubt()
    ? { ok: true, url: `${returnUrl}?mock=1`, mock: true }
    : { ok: false, url: null, mock: false, error: "Die Zahlungsanbindung ist nicht verfügbar." };
  try {
    const link = await client.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });
    return { ok: true, url: link.url, mock: false };
  } catch (e: any) {
    return { ok: false, url: null, mock: false, error: e?.message ?? "stripe_error" };
  }
}

// Aktuellen Freischaltstatus abfragen (Zahlungen/Auszahlungen moeglich?).
export async function getConnectStatus(accountId: string | null): Promise<ConnectStatus> {
  const empty: ConnectStatus = {
    accountId,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    requirementsDue: [],
    mock: false,
  };
  if (!accountId) return empty;
  if (accountId.startsWith("mock_")) {
    // Ein Ersatz-Konto gilt NUR im Testbetrieb als auszahlungsbereit. Im
    // Echtbetrieb muss es als nicht bereit gelten – sonst wuerde die App
    // Fahrpreise an ein erfundenes Konto zu ueberweisen versuchen und dem
    // Unternehmen faelschlich "Auszahlungen aktiv" anzeigen.
    if (!ersatzbetriebErlaubt()) return { ...empty, mock: true };
    return { ...empty, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, mock: true };
  }
  const client = await getClient();
  if (!client) return { ...empty, mock: true };
  try {
    const a = await client.accounts.retrieve(accountId);
    return {
      accountId,
      chargesEnabled: !!a.charges_enabled,
      payoutsEnabled: !!a.payouts_enabled,
      detailsSubmitted: !!a.details_submitted,
      requirementsDue: a.requirements?.currently_due ?? [],
      mock: false,
    };
  } catch {
    return empty;
  }
}

// Link ins Stripe-Express-Dashboard (Auszahlungen einsehen).
export async function createLoginLink(accountId: string): Promise<string | null> {
  const client = await getClient();
  if (!client || isMock(accountId)) return null;
  try {
    const link = await client.accounts.createLoginLink(accountId);
    return link.url ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Gespeicherte Kundenkarten (Zahlung ERST nach Fahrtende)
//
// Die Karte wird per SetupIntent am PLATTFORM-Stripe-Kunden gespeichert und
// dabei einmalig authentifiziert (usage: off_session). Dadurch:
//  - liegen niemals Kartendaten in unserer Datenbank,
//  - muss der Kunde die Karte nur EINMAL eingeben,
//  - funktioniert dieselbe Karte bei JEDEM verbundenen Taxiunternehmen,
//    weil die Belastung als Destination-Charge ueber die Plattform laeuft,
//  - wird bei Vorbestellungen KEIN Geld tagelang blockiert (kein Hold).
// ---------------------------------------------------------------------------

export interface StripeCardInfo {
  paymentMethodId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

// Stripe-Kunden anlegen (einmalig je Kundenkonto).
export async function createStripeCustomer(
  data: { email?: string | null; name?: string | null; phone?: string | null },
  metadata: Record<string, string> = {},
): Promise<{ ok: boolean; customerId: string | null; mock: boolean; error?: string }> {
  const client = await getClient();
  if (!client) return ersatzbetriebErlaubt()
    ? { ok: true, customerId: mockRef("mock_cus"), mock: true }
    : { ok: false, customerId: null, mock: false, error: "Die Zahlungsanbindung ist nicht verfügbar." };
  try {
    const c = await client.customers.create({
      email: data.email ?? undefined,
      name: data.name ?? undefined,
      phone: data.phone ?? undefined,
      metadata,
    });
    return { ok: true, customerId: c.id, mock: false };
  } catch (e: any) {
    // Ohne diese Meldung sieht der Aufrufer nur "Zahlungskonto konnte nicht
    // vorbereitet werden" und der eigentliche Grund geht verloren.
    console.error("Stripe: Kunde anlegen fehlgeschlagen:", e?.code ?? e?.type ?? "", e?.message ?? e);
    return { ok: false, customerId: null, mock: false, error: e?.message ?? "stripe_error" };
  }
}

// SetupIntent: Karte hinterlegen + fuer spaetere Abbuchungen freigeben.
export async function createCardSetupIntent(
  stripeCustomerId: string,
): Promise<{ ok: boolean; clientSecret: string | null; setupIntentId: string | null; mock: boolean; error?: string }> {
  const client = await getClient();
  if (!client || isMock(stripeCustomerId)) {
    return { ok: true, clientSecret: null, setupIntentId: mockRef("mock_seti"), mock: true };
  }
  try {
    const si = await client.setupIntents.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      usage: "off_session", // spaetere Belastung ohne erneute Eingabe
    });
    return { ok: true, clientSecret: si.client_secret ?? null, setupIntentId: si.id, mock: false };
  } catch (e: any) {
    return { ok: false, clientSecret: null, setupIntentId: null, mock: false, error: e?.message ?? "stripe_error" };
  }
}

// Anzeigedaten einer Karte holen (Marke, letzte 4 Ziffern, Ablauf).
export async function getCardInfo(paymentMethodId: string): Promise<StripeCardInfo | null> {
  const client = await getClient();
  if (!client || isMock(paymentMethodId)) {
    return { paymentMethodId, brand: "visa", last4: "4242", expMonth: 12, expYear: new Date().getFullYear() + 3 };
  }
  try {
    const pm = await client.paymentMethods.retrieve(paymentMethodId);
    if (!pm?.card) return null;
    return {
      paymentMethodId: pm.id,
      brand: pm.card.brand ?? "card",
      last4: pm.card.last4 ?? "????",
      expMonth: pm.card.exp_month ?? 0,
      expYear: pm.card.exp_year ?? 0,
    };
  } catch {
    return null;
  }
}

// Karte vom Kunden loesen (entfernen).
export async function detachCard(paymentMethodId: string): Promise<boolean> {
  const client = await getClient();
  // Im Echtbetrieb muss die Zahlungsmethode wirklich bei Stripe geloest werden;
  // sonst behaupteten wir eine Loeschung, die nie stattgefunden hat.
  if (!client) return ersatzbetriebErlaubt();
  if (isMock(paymentMethodId)) return true;
  try {
    await client.paymentMethods.detach(paymentMethodId);
    return true;
  } catch {
    return false;
  }
}

export interface ChargeResult {
  ok: boolean;
  paymentIntentId: string | null;
  amount: number | null; // EUR
  status: PaymentState;
  mock: boolean;
  // Klartext fuer den Kunden, falls die Belastung scheitert.
  error?: string;
  code?: string;
  requiresAction?: boolean;
}

// Verstaendliche Meldung statt Stripe-Fehlercode.
function chargeErrorText(e: any): string {
  const code = e?.code ?? e?.decline_code ?? "";
  if (code === "card_declined") return "Ihre Karte wurde abgelehnt.";
  if (code === "expired_card") return "Ihre Karte ist abgelaufen.";
  if (code === "insufficient_funds") return "Die Karte weist keine ausreichende Deckung auf.";
  if (code === "incorrect_cvc") return "Die Prüfnummer der Karte ist falsch.";
  if (code === "authentication_required") return "Ihre Bank verlangt eine Bestätigung der Zahlung.";
  if (code === "processing_error") return "Die Zahlung konnte technisch nicht verarbeitet werden.";
  return e?.message ?? "Die Zahlung konnte nicht durchgeführt werden.";
}

// Endgueltige Belastung NACH der Fahrt: Fahrpreis + Trinkgeld, direkt an das
// Taxiunternehmen (Destination-Charge, KEINE Plattform-Provision).
export async function chargeSavedCard(opts: {
  stripeCustomerId: string;
  paymentMethodId: string;
  amountEur: number;
  destinationAccountId?: string | null;
  metadata?: Record<string, string>;
}): Promise<ChargeResult> {
  const cents = toCents(opts.amountEur);
  const client = await getClient();
  if (!client || isMock(opts.paymentMethodId) || isMock(opts.stripeCustomerId)) {
    // Im Echtbetrieb NIE Erfolg melden – weder ohne Verbindung noch mit einer
    // Ersatz-Kennung, die aus einem frueheren Lauf ohne Schluessel stammt.
    if (!ersatzbetriebErlaubt()) {
      return { ok: false, paymentIntentId: null, amount: null, status: "FEHLGESCHLAGEN", mock: false,
               error: "Die Zahlungsanbindung ist nicht verfügbar. Bitte bar bezahlen.", code: "stripe_unavailable" };
    }
    return { ok: true, paymentIntentId: mockRef("mock_pi"), amount: cents / 100, status: "BEZAHLT", mock: true };
  }
  try {
    const pi = await client.paymentIntents.create({
      amount: cents,
      currency: "eur",
      customer: opts.stripeCustomerId,
      payment_method: opts.paymentMethodId,
      off_session: true, // Kunde ist nicht mehr auf der Seite
      confirm: true,
      metadata: opts.metadata ?? {},
      ...(opts.destinationAccountId
        ? { transfer_data: { destination: opts.destinationAccountId }, on_behalf_of: opts.destinationAccountId }
        : {}),
    });
    const ok = pi.status === "succeeded";
    return {
      ok,
      paymentIntentId: pi.id,
      amount: (pi.amount_received ?? pi.amount) / 100,
      status: ok ? "BEZAHLT" : "FEHLGESCHLAGEN",
      mock: false,
      ...(ok ? {} : { error: "Die Zahlung wurde nicht abgeschlossen.", code: pi.status }),
    };
  } catch (e: any) {
    // Kann die Firma (noch) kein Geld empfangen, ueber das Plattform-Konto
    // abrechnen statt die Fahrt unbezahlt zu lassen.
    const destProblem = /destination|on_behalf_of|capabilit/i.test(e?.message ?? "");
    if (opts.destinationAccountId && destProblem) {
      console.warn("Stripe: Direktzahlung an die Firma abgelehnt, Fallback aufs Plattform-Konto:", e?.message);
      return chargeSavedCard({ ...opts, destinationAccountId: null });
    }
    return {
      ok: false,
      paymentIntentId: e?.raw?.payment_intent?.id ?? null,
      amount: null,
      status: "FEHLGESCHLAGEN",
      mock: false,
      error: chargeErrorText(e),
      code: e?.code ?? e?.decline_code ?? "stripe_error",
      requiresAction: e?.code === "authentication_required",
    };
  }
}

/**
 * Karte hinterlegen ueber die von Stripe GEHOSTETE Seite (Checkout, mode "setup").
 *
 * Vorteil gegenueber Stripe Elements: es wird KEIN oeffentlicher Schluessel
 * (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) im Browser benoetigt. Der Kunde wird zu
 * Stripe weitergeleitet, gibt die Kartendaten dort ein und kommt zurueck – die
 * Daten beruehren unseren Server nie.
 */
export async function createCardSetupCheckout(
  stripeCustomerId: string,
  returnUrl: string,
  cancelUrl: string,
): Promise<{ ok: boolean; url: string | null; mock: boolean; error?: string }> {
  const client = await getClient();
  if (!client || isMock(stripeCustomerId)) {
    return { ok: true, url: null, mock: true };
  }
  try {
    const session = await client.checkout.sessions.create({
      mode: "setup",
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      locale: "de",
      success_url: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}setup={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
    });
    return { ok: true, url: session.url ?? null, mock: false };
  } catch (e: any) {
    return { ok: false, url: null, mock: false, error: e?.message ?? "stripe_error" };
  }
}

/**
 * Nach der Rueckkehr von der Stripe-Seite: die gespeicherte Zahlungsmethode
 * aus der Checkout-Sitzung auslesen.
 */
export async function paymentMethodFromSetupSession(sessionId: string): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;
  try {
    const session = await client.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
    const si: any = session.setup_intent;
    if (!si) return null;
    const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
    return pm ?? null;
  } catch {
    return null;
  }
}

/**
 * Zahlungsfaehigkeit pruefen und den Betrag kurzzeitig reservieren.
 *
 * Wird gesetzt, sobald die Fahrt LIVE geht (Fahrer unterwegs) – NICHT beim
 * Buchen. Dadurch ist bei Vorbestellungen kein Geld tagelang blockiert, der
 * Betrag ist aber waehrend der Fahrt gesichert. Am Fahrtende wird der
 * tatsaechliche Preis daraus eingezogen (capturePayment), bei Storno
 * freigegeben (voidPayment).
 *
 * Schlaegt das fehl (keine Deckung, Karte gesperrt/abgelaufen), erfaehrt es
 * die Zentrale, BEVOR der Gast mitgefahren ist.
 */
export async function holdOnSavedCard(opts: {
  stripeCustomerId: string;
  paymentMethodId: string;
  amountEur: number;
  destinationAccountId?: string | null;
  metadata?: Record<string, string>;
}): Promise<{ ok: boolean; ref: string | null; amount: number | null; mock: boolean; error?: string; code?: string }> {
  const cents = toCents(opts.amountEur);
  const client = await getClient();
  if (!client || isMock(opts.paymentMethodId) || isMock(opts.stripeCustomerId)) {
    if (!ersatzbetriebErlaubt()) {
      return { ok: false, ref: null, amount: null, mock: false,
               error: "Die Zahlungsanbindung ist nicht verfügbar. Bitte bar bezahlen.", code: "stripe_unavailable" };
    }
    return { ok: true, ref: mockRef("mock_hold"), amount: cents / 100, mock: true };
  }
  try {
    const pi = await client.paymentIntents.create({
      amount: cents,
      currency: "eur",
      customer: opts.stripeCustomerId,
      payment_method: opts.paymentMethodId,
      capture_method: "manual", // nur reservieren, nicht abbuchen
      off_session: true,
      confirm: true,
      metadata: opts.metadata ?? {},
      ...(opts.destinationAccountId
        ? { transfer_data: { destination: opts.destinationAccountId }, on_behalf_of: opts.destinationAccountId }
        : {}),
    });
    const ok = pi.status === "requires_capture";
    return {
      ok,
      ref: pi.id,
      amount: pi.amount / 100,
      mock: false,
      ...(ok ? {} : { error: "Die Karte konnte nicht bestätigt werden.", code: pi.status }),
    };
  } catch (e: any) {
    // Firmenkonto (noch) nicht auszahlungsbereit -> ueber das Plattform-Konto.
    if (opts.destinationAccountId && /destination|on_behalf_of|capabilit/i.test(e?.message ?? "")) {
      return holdOnSavedCard({ ...opts, destinationAccountId: null });
    }
    return {
      ok: false,
      ref: e?.raw?.payment_intent?.id ?? null,
      amount: null,
      mock: false,
      error: chargeErrorText(e),
      code: e?.code ?? e?.decline_code ?? "stripe_error",
    };
  }
}
