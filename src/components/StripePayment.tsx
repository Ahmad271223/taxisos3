"use client";

import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

// Publishable Key wird zur Build-Zeit inlined; ohne Key bleibt die Komponente
// inaktiv (BookingForm fällt dann auf den normalen Bestell-Button zurück).
const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = PK ? loadStripe(PK) : null;

interface Pt {
  lat: number;
  lng: number;
}
interface Params {
  pickup: Pt;
  dest: Pt;
  stops: Pt[];
  company?: string;
}

export function StripePayment({
  params,
  disabled,
  submitting,
  onAuthorized,
}: {
  params: Params;
  disabled?: boolean;
  submitting?: boolean;
  onAuthorized: (paymentIntentId: string) => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify([params.pickup, params.dest, params.stops, params.company]);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setClientSecret(null);
    fetch("/api/payments/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.clientSecret) {
          setClientSecret(d.clientSecret);
          setAmount(d.amount ?? null);
        } else {
          setErr(d.error ?? "Zahlung konnte nicht vorbereitet werden.");
        }
      })
      .catch(() => !cancelled && setErr("Netzwerkfehler."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!stripePromise) return null;
  if (err) return <p className="text-sm font-bold text-red-600" data-testid="stripe-error">{err}</p>;
  if (!clientSecret) return <p className="text-sm text-ink-500">Zahlung wird vorbereitet …</p>;

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <InnerForm disabled={disabled} submitting={submitting} amount={amount} onAuthorized={onAuthorized} />
    </Elements>
  );
}

function InnerForm({
  disabled,
  submitting,
  amount,
  onAuthorized,
}: {
  disabled?: boolean;
  submitting?: boolean;
  amount: number | null;
  onAuthorized: (paymentIntentId: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pay() {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) {
      setErr(error.message ?? "Kartenzahlung fehlgeschlagen.");
      setBusy(false);
      return;
    }
    // Manueller Capture -> erfolgreicher Hold = "requires_capture".
    if (paymentIntent && (paymentIntent.status === "requires_capture" || paymentIntent.status === "succeeded")) {
      onAuthorized(paymentIntent.id);
    } else {
      setErr("Autorisierung nicht abgeschlossen. Bitte erneut versuchen.");
      setBusy(false);
    }
  }

  const label =
    busy || submitting
      ? "Wird verarbeitet …"
      : amount != null
      ? `${(amount / 100).toFixed(2)} € autorisieren & bestellen`
      : "Karte autorisieren & bestellen";

  return (
    <div className="grid gap-3">
      <div className="rounded-2xl border border-ink-200 bg-white p-4">
        <PaymentElement />
      </div>
      {err && <p className="text-xs font-bold text-red-600" data-testid="stripe-pay-error">{err}</p>}
      <button
        type="button"
        onClick={pay}
        disabled={disabled || busy || submitting || !stripe}
        data-testid="stripe-pay"
        className="btn-primary text-lg disabled:opacity-60"
      >
        {label}
      </button>
      <p className="text-center text-[11px] text-ink-400">Es wird nur der Höchstbetrag reserviert; belastet wird der tatsächliche Fahrpreis nach der Fahrt.</p>
    </div>
  );
}
