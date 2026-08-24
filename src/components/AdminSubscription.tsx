"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { formatEuro, formatDateTime } from "@/lib/format";

// Unternehmens-Abo: Tarif waehlen, Zahlung einrichten, Rechnungen einsehen.
// Wichtig: Das Abo ist von den Fahrt-Zahlungen vollstaendig getrennt.

const STATUS_STYLE: Record<string, string> = {
  AKTIV: "bg-green-100 text-green-800",
  TRIAL: "bg-brand-100 text-ink-900",
  UEBERFAELLIG: "bg-red-100 text-red-700",
  GEKUENDIGT: "bg-ink-200 text-ink-700",
};

export function AdminSubscription() {
  const [data, setData] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("erfolg")) setNotice("Vielen Dank – Ihr Abo ist aktiv.");
    if (p.get("abbruch")) setNotice("Der Vorgang wurde abgebrochen. Es wurde nichts abgebucht.");
    load();
  }, [load]);

  async function start(planId?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(planId ? { plan: planId, action: "new" } : {}),
      });
      const d = await res.json().catch(() => ({}));
      if (d?.url) {
        window.location.href = d.url;
        return;
      }
      setError(d?.error ?? "Der Vorgang konnte nicht gestartet werden.");
    } catch {
      setError("Netzwerkfehler.");
    }
    setBusy(false);
  }

  if (!data) {
    return <main className="grid min-h-screen place-items-center bg-ink-50 text-ink-500">Lädt …</main>;
  }

  const s = data.subscription;
  const plans = data.plans ?? [];

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Brand subtitle="Abo & Abrechnung" />
          <Link href="/admin" className="text-sm font-bold text-ink-500 hover:text-ink-900">
            Zurück zum Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-4xl gap-4 px-5 py-6">
        {notice && (
          <p data-testid="sub-notice" className="rounded-2xl bg-green-50 px-4 py-3 font-semibold text-green-800">
            {notice}
          </p>
        )}
        {error && (
          <p data-testid="sub-error" className="rounded-2xl bg-red-50 px-4 py-3 font-semibold text-red-700">
            {error}
          </p>
        )}

        {/* Aktueller Tarif */}
        <div className="card p-5" data-testid="subscription-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="eyebrow text-ink-400">Ihr Tarif</p>
              <p className="font-display text-2xl font-extrabold text-ink-900" data-testid="sub-plan">
                {s.planName} · {formatEuro(s.monthlyPrice)} / Monat
              </p>
              <p className="mt-1 text-sm text-ink-600">
                {data.driverCount} von {s.maxDrivers} Fahrern angelegt
                {data.driversLeft > 0 ? ` · noch ${data.driversLeft} frei` : " · Kontingent ausgeschöpft"}
              </p>
            </div>
            <span
              data-testid="sub-status"
              className={`rounded-full px-3 py-1 text-xs font-extrabold ${STATUS_STYLE[s.status] ?? "bg-ink-100"}`}
            >
              {s.statusLabel}
            </span>
          </div>

          {s.until && (
            <p className="mt-3 text-sm text-ink-500">
              {s.status === "GEKUENDIGT" ? "Läuft noch bis " : "Nächste Abrechnung am "}
              <b className="text-ink-800">{formatDateTime(s.until)}</b>
            </p>
          )}

          {s.status === "UEBERFAELLIG" && (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              Die letzte Abbuchung ist fehlgeschlagen. Bitte aktualisieren Sie Ihr Zahlungsmittel,
              damit Ihr Zugang aktiv bleibt.
            </p>
          )}

          {data.recommendedPlan && (
            <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-sm font-semibold text-ink-800">
              Sie haben mehr Fahrer angelegt, als Ihr Tarif erlaubt. Empfohlen:{" "}
              <b>{data.recommendedPlan.name}</b> ({formatEuro(data.recommendedPlan.monthlyPrice)}/Monat).
            </p>
          )}

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {s.hasSubscription ? (
              <button
                type="button"
                onClick={() => start()}
                disabled={busy}
                data-testid="sub-manage"
                className="btn-primary justify-center disabled:opacity-60"
              >
                {busy ? "Öffne …" : "Abo verwalten"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => start(s.plan)}
                disabled={busy || !data.stripeConfigured}
                data-testid="sub-start"
                className="btn-primary justify-center disabled:opacity-60"
              >
                {busy ? "Öffne …" : `${s.planName} buchen`}
              </button>
            )}
            <Link href="/admin" className="btn-ghost justify-center text-center">
              Später
            </Link>
          </div>

          {s.hasSubscription && (
            <p className="mt-2 text-xs text-ink-400">
              Im Kundenportal ändern Sie Tarif und Zahlungsmittel, sehen Rechnungen und können kündigen.
            </p>
          )}
          {!data.stripeConfigured && (
            <p className="mt-2 text-xs text-ink-400">Abrechnung ist noch nicht eingerichtet.</p>
          )}
        </div>

        {/* Tarifübersicht */}
        <div className="card p-5">
          <h2 className="font-display text-lg font-extrabold text-ink-900">Tarife</h2>
          <p className="text-sm text-ink-500">
            Alle Tarife enthalten unbegrenzte Fahrten. Wir behalten <b>keine Provision</b> je Fahrt ein –
            die Fahrpreise gehen vollständig an Sie.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {plans.map((p: any) => {
              const current = p.id === s.plan;
              const tooSmall = p.maxDrivers < data.driverCount;
              return (
                <div
                  key={p.id}
                  data-testid={`plan-${p.id}`}
                  className={`rounded-2xl border p-4 ${
                    current ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-display font-extrabold text-ink-900">{p.name}</p>
                    {current && (
                      <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-extrabold text-ink-900">
                        Aktuell
                      </span>
                    )}
                  </div>
                  <p className="font-display text-2xl font-extrabold text-ink-900">
                    {formatEuro(p.monthlyPrice)}
                    <span className="text-sm font-semibold text-ink-500"> / Monat</span>
                  </p>
                  <p className="mt-1 text-sm text-ink-600">Bis zu {p.maxDrivers} Fahrer</p>
                  {!current && (
                    <button
                      type="button"
                      onClick={() => start(s.hasSubscription ? undefined : p.id)}
                      disabled={busy || tooSmall || !data.stripeConfigured}
                      data-testid={`plan-choose-${p.id}`}
                      className="mt-3 w-full rounded-xl border border-ink-300 px-3 py-2 text-sm font-bold text-ink-800 transition hover:bg-ink-50 disabled:opacity-50"
                    >
                      {tooSmall ? `Zu klein (${data.driverCount} Fahrer)` : s.hasSubscription ? "Wechseln" : "Wählen"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Rechnungen */}
        {(data.invoices ?? []).length > 0 && (
          <div className="card p-5" data-testid="sub-invoices">
            <h2 className="font-display text-lg font-extrabold text-ink-900">Rechnungen</h2>
            <div className="mt-3 grid gap-2">
              {data.invoices.map((i: any) => (
                <div
                  key={i.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-200 bg-white p-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink-900">{i.number ?? i.id}</p>
                    <p className="text-xs text-ink-500">
                      {i.periodStart ? formatDateTime(i.periodStart) : ""}
                      {i.periodEnd ? ` – ${formatDateTime(i.periodEnd)}` : ""}
                    </p>
                  </div>
                  <span className="font-bold text-ink-900">{formatEuro(i.amount)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${
                      i.status === "paid" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {i.status === "paid" ? "Bezahlt" : "Offen"}
                  </span>
                  {i.pdfUrl && (
                    <a href={i.pdfUrl} target="_blank" rel="noreferrer" className="btn-ghost text-xs">
                      PDF
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-ink-400">
          Fahrgast-Zahlungen und Ihr Abo sind vollständig getrennt: Fahrpreise gehen direkt auf Ihr
          Auszahlungskonto, das Abo wird separat von Ihrer hinterlegten Zahlungsart abgebucht.
        </p>
      </div>
    </main>
  );
}
