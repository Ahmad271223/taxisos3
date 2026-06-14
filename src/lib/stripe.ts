// Stripe Authorize-then-Capture (Phase 2g).
//
// Ablauf:
//  1. Bestellung mit Zahlart CARD  -> authorizePayment(): PaymentIntent mit
//     capture_method="manual" anlegen und sofort bestaetigen. Das reserviert
//     (autorisiert) den Betrag auf der Karte, belastet ihn aber noch NICHT.
//  2. Fahrtende  -> capturePayment(): exakten Fahrpreis (<= autorisiert) belasten.
//  3. Stornierung -> voidPayment(): Autorisierung wieder freigeben.
//
// Ohne STRIPE_SECRET_KEY (lokal / CI) laeuft alles im Mock-Modus: es werden
// `mock_*`-Referenzen vergeben und keine echten Stripe-Calls abgesetzt. Dadurch
// bleibt der Bestell-/Abschluss-Flow auch ohne Schluessel funktionsfaehig.

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
      .catch(() => null);
  }
  return clientPromise;
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
  return !ref || ref.startsWith("mock_");
}

// Mock-Autorisierung (nur ohne Stripe-Key, z. B. lokal/CI). Der echte Hold
// entsteht clientseitig: createAuthIntent() -> Karteneingabe (Stripe Elements)
// -> confirmPayment() -> Server verifiziert via retrieveIntent().
export async function authorizePayment(
  _amountEur: number,
  _metadata: Record<string, string> = {},
): Promise<PayResult> {
  return { ok: true, ref: mockRef("mock_auth"), status: "AUTORISIERT", mock: true };
}

export interface IntentResult {
  ok: boolean;
  mock: boolean;
  clientSecret: string | null;
  id: string | null;
  amount: number | null; // Cent
  error?: string;
}

// PaymentIntent mit manueller Erfassung anlegen (Hold). Wird vom Client mit der
// eingegebenen Karte bestaetigt (confirmPayment) -> Status "requires_capture".
export async function createAuthIntent(amountEur: number, metadata: Record<string, string> = {}): Promise<IntentResult> {
  const cents = toCents(amountEur);
  const client = await getClient();
  if (!client) {
    return { ok: true, mock: true, clientSecret: null, id: mockRef("mock_pi"), amount: cents };
  }
  try {
    const pi = await client.paymentIntents.create({
      amount: cents,
      currency: "eur",
      capture_method: "manual",
      payment_method_types: ["card"],
      metadata,
    });
    return { ok: true, mock: false, clientSecret: pi.client_secret ?? null, id: pi.id, amount: pi.amount };
  } catch (e: any) {
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
  if (isMock(ref)) {
    return { ok: true, ref: ref ?? null, status: "BEZAHLT", mock: true };
  }
  const client = await getClient();
  if (!client) return { ok: true, ref, status: "BEZAHLT", mock: true };
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
  if (isMock(ref)) {
    return { ok: true, ref: ref ?? null, status: "STORNIERT", mock: true };
  }
  const client = await getClient();
  if (!client) return { ok: true, ref, status: "STORNIERT", mock: true };
  try {
    const pi = await client.paymentIntents.cancel(ref as string);
    return { ok: true, ref: pi.id, status: "STORNIERT", mock: false };
  } catch (e: any) {
    return { ok: false, ref, status: "FEHLGESCHLAGEN", mock: false, error: e?.message ?? "stripe_error" };
  }
}
