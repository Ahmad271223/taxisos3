"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// Kartenauswahl bei der Buchung.
// Es wird NICHTS reserviert und NICHTS abgebucht – die gewaehlte Karte wird nur
// fuer die spaetere Zahlung nach Fahrtende vorgemerkt.

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

export function CardChooser({
  value,
  onChange,
  loggedIn,
}: {
  value: string | null;
  onChange: (cardId: string | null, usable: boolean) => void;
  loggedIn: boolean;
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!loggedIn) {
      setLoading(false);
      onChange(null, false);
      return;
    }
    fetch("/api/customer/payment-methods")
      .then((r) => (r.ok ? r.json() : { cards: [] }))
      .then((d) => {
        const list: Card[] = d.cards ?? [];
        setCards(list);
        const usable = list.filter((c) => !c.expired);
        const preselect = usable.find((c) => c.isDefault) ?? usable[0] ?? null;
        onChange(preselect?.id ?? null, usable.length > 0);
      })
      .catch(() => onChange(null, false))
      .finally(() => setLoading(false));
    // onChange ist bewusst nicht in den Deps: sonst laedt es bei jedem Render neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  useEffect(() => {
    load();
  }, [load]);

  if (!loggedIn) {
    return (
      <div className="rounded-2xl bg-ink-50 p-4 text-sm" data-testid="card-login-required">
        <p className="font-semibold text-ink-900">Für Kartenzahlung bitte anmelden</p>
        <p className="mt-1 text-ink-600">
          Ihre Karte wird sicher in Ihrem Konto hinterlegt – so müssen Sie sie nur einmal eingeben.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Link href="/konto" className="btn-primary justify-center text-center text-sm">
            Anmelden
          </Link>
          <Link href="/konto" className="btn-ghost justify-center text-center text-sm">
            Konto erstellen
          </Link>
        </div>
      </div>
    );
  }

  if (loading) return <p className="text-sm text-ink-400">Zahlungsmethoden werden geladen …</p>;

  if (cards.length === 0) {
    return (
      <div className="rounded-2xl bg-ink-50 p-4 text-sm" data-testid="card-none">
        <p className="font-semibold text-ink-900">Noch keine Karte hinterlegt</p>
        <p className="mt-1 text-ink-600">Fügen Sie eine Karte hinzu – abgebucht wird erst nach der Fahrt.</p>
        <Link href="/konto?tab=payment" className="btn-primary mt-3 w-full justify-center text-center text-sm">
          Karte hinzufügen
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-2" data-testid="card-chooser">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Zahlungsmittel</p>
      {cards.map((c) => {
        const selected = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            disabled={c.expired}
            data-testid={`choose-card-${c.id}`}
            onClick={() => onChange(c.id, true)}
            className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition disabled:opacity-50 ${
              selected ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white hover:border-brand-300"
            }`}
          >
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                selected ? "border-brand-500" : "border-ink-300"
              }`}
            >
              {selected && <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink-900">
                {c.brand} •••• {c.last4}
              </span>
              <span className={`block text-xs ${c.expired ? "font-bold text-red-600" : "text-ink-500"}`}>
                {c.expired
                  ? "Abgelaufen"
                  : c.isDefault
                  ? "Standardkarte"
                  : `Gültig bis ${String(c.expMonth).padStart(2, "0")}/${String(c.expYear).slice(-2)}`}
              </span>
            </span>
          </button>
        );
      })}
      <Link
        href="/konto?tab=payment"
        data-testid="add-other-card"
        className="rounded-2xl border border-dashed border-ink-300 p-3 text-center text-sm font-semibold text-ink-600 transition hover:border-brand-400 hover:text-ink-900"
      >
        + Andere Karte verwenden
      </Link>
      <p className="text-[11px] text-ink-400">
        Es wird jetzt <b>nichts</b> abgebucht und <b>nichts</b> reserviert. Die Zahlung erfolgt erst nach Ende der Fahrt.
      </p>
    </div>
  );
}
