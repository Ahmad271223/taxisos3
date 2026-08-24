"use client";

import { useCallback, useEffect, useState } from "react";

// Zahlungsmethoden im Kundenkonto: Karten hinterlegen, Standardkarte waehlen,
// Karten entfernen.
//
// Die Karteneingabe laeuft auf der von Stripe gehosteten Seite. Dadurch
// braucht der Browser KEINEN Stripe-Schluessel, und Kartendaten erreichen
// unseren Server zu keinem Zeitpunkt. Bei uns liegen nur Marke, die letzten
// vier Ziffern und das Ablaufdatum.

interface Card {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
  expired: boolean;
  label: string;
}

export function PaymentMethods() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stripeReady, setStripeReady] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    return fetch("/api/customer/payment-methods")
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((d) => {
        setCards(d.cards ?? []);
        setStripeReady(d.stripeConfigured !== false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Rueckkehr von der Stripe-Seite: Karte uebernehmen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("setup");
    const abbruch = params.get("abbruch");

    const clean = () => {
      params.delete("setup");
      params.delete("abbruch");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    };

    if (abbruch) {
      setNotice("Das Hinzufügen der Karte wurde abgebrochen. Es wurde nichts gespeichert.");
      clean();
      load();
      return;
    }
    if (sessionId) {
      setBusy(true);
      fetch("/api/customer/payment-methods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (ok) setNotice(`Karte ${d.card?.label ?? ""} wurde gespeichert.`);
          else setError(d?.error ?? "Karte konnte nicht gespeichert werden.");
        })
        .catch(() => setError("Karte konnte nicht gespeichert werden."))
        .finally(() => {
          setBusy(false);
          clean();
          load();
        });
      return;
    }
    load();
  }, [load]);

  // Karte hinzufuegen -> Weiterleitung zu Stripe.
  async function addCard() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/customer/payment-methods", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "Karte konnte nicht vorbereitet werden.");
        setBusy(false);
        return;
      }
      if (d.url) {
        window.location.href = d.url; // gehostete Stripe-Seite
        return;
      }
      setError("Die Kartenerfassung ist derzeit nicht verfügbar.");
    } catch {
      setError("Netzwerkfehler.");
    }
    setBusy(false);
  }

  async function makeDefault(id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/customer/payment-methods/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) setCards(d.cards ?? []);
    else setError(d.error ?? "Standardkarte konnte nicht gesetzt werden.");
    setBusyId(null);
  }

  async function remove(id: string) {
    if (!window.confirm("Diese Karte wirklich entfernen?")) return;
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/customer/payment-methods/${id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (res.ok) setCards(d.cards ?? []);
    else setError(d.error ?? "Karte konnte nicht entfernt werden.");
    setBusyId(null);
  }

  return (
    <div className="card p-5" data-testid="payment-methods">
      <h2 className="font-display text-lg font-extrabold text-ink-900">Zahlungsmethoden</h2>
      <p className="text-sm text-ink-500">
        Einmal hinterlegen – nutzbar bei allen Taxiunternehmen. Abgebucht wird erst nach der Fahrt.
      </p>

      {notice && (
        <p data-testid="payment-methods-notice" className="mt-3 rounded-xl bg-green-50 px-3 py-2 text-sm font-bold text-green-800">
          {notice}
        </p>
      )}
      {error && (
        <p data-testid="payment-methods-error" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-ink-400">Lädt …</p>
      ) : cards.length === 0 ? (
        <p className="mt-4 rounded-xl bg-ink-50 px-3 py-3 text-sm text-ink-600" data-testid="no-cards">
          Noch keine Karte hinterlegt. Für Kartenzahlung fügen Sie bitte eine Karte hinzu.
        </p>
      ) : (
        <div className="mt-4 grid gap-2">
          {cards.map((c) => (
            <div
              key={c.id}
              data-testid={`card-${c.id}`}
              className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 ${
                c.isDefault ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white"
              }`}
            >
              <span className="grid h-9 w-12 shrink-0 place-items-center rounded-lg bg-ink-900 text-[10px] font-extrabold uppercase text-white">
                {c.brand.slice(0, 4)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-900">
                  {c.brand} •••• {c.last4}
                </p>
                <p className={`text-xs ${c.expired ? "font-bold text-red-600" : "text-ink-500"}`}>
                  {c.expired
                    ? "Abgelaufen – bitte ersetzen"
                    : `Gültig bis ${String(c.expMonth).padStart(2, "0")}/${String(c.expYear).slice(-2)}`}
                </p>
              </div>
              {c.isDefault ? (
                <span className="shrink-0 rounded-full bg-brand-500 px-2.5 py-0.5 text-xs font-extrabold text-ink-900">
                  Standardkarte
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => makeDefault(c.id)}
                  disabled={busyId === c.id || c.expired}
                  data-testid={`card-default-${c.id}`}
                  className="shrink-0 rounded-xl border border-ink-300 px-3 py-1.5 text-xs font-bold text-ink-700 transition hover:bg-ink-50 disabled:opacity-50"
                >
                  Als Standard
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={busyId === c.id}
                data-testid={`card-remove-${c.id}`}
                className="shrink-0 rounded-xl px-2 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                Entfernen
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addCard}
        disabled={busy || !stripeReady}
        data-testid="add-card"
        className="btn-primary mt-4 w-full justify-center disabled:opacity-60"
      >
        {busy ? "Weiterleitung zu Stripe …" : "+ Zahlungsmethode hinzufügen"}
      </button>

      <p className="mt-2 text-center text-[11px] text-ink-400">
        {stripeReady
          ? "Die Karteneingabe erfolgt auf der gesicherten Seite von Stripe. Ihre Kartendaten werden bei uns nie gespeichert."
          : "Kartenzahlung ist derzeit nicht eingerichtet. Bitte wählen Sie bei der Buchung Barzahlung."}
      </p>
    </div>
  );
}
