"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";

// Auszahlungskonto des Taxiunternehmens (Stripe Connect).
//
// Ohne diese Seite gab es keinen Weg, ein Konto zu hinterlegen: die
// Schnittstelle war fertig, aber niemand konnte sie aufrufen. Fahrpreise
// landeten dadurch auf dem Plattform-Konto und mussten von Hand
// weitergereicht werden.
//
// Ablauf:
//   1. "Auszahlungskonto einrichten" -> Stripe legt ein Express-Konto an und
//      fuehrt durch die Identitaetspruefung (Ausweis, IBAN, Steuerdaten).
//   2. Zurueck in TaxiOS: der Status wird abgeholt und gespeichert.
//   3. Ab dann geht JEDE Kartenzahlung eines Fahrgasts direkt auf dieses
//      Konto - ohne Zwischenstopp bei uns, ohne Provision.

interface Connect {
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  mock: boolean;
}

// Stripe nennt die offenen Punkte in eigener Sprache. Die haeufigsten
// uebersetzen wir, damit die Zentrale weiss, was sie nachreichen muss.
const NACHWEIS_TEXT: Record<string, string> = {
  "individual.verification.document": "Ausweisdokument der vertretungsberechtigten Person",
  "company.verification.document": "Registerauszug des Unternehmens",
  "external_account": "Bankverbindung (IBAN) für die Auszahlung",
  "business_profile.url": "Internetadresse oder Beschreibung des Unternehmens",
  "individual.address.line1": "Anschrift der vertretungsberechtigten Person",
  "tax_id": "Steuernummer bzw. Umsatzsteuer-Identifikationsnummer",
};

function nachweis(key: string): string {
  return NACHWEIS_TEXT[key] ?? key;
}

export function AdminPayout() {
  const [data, setData] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/connect")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    // Rueckkehr von Stripe: der Status wird beim Laden ohnehin frisch geholt.
    if (p.get("return")) setNotice("Angaben übermittelt. Der Status wird von Stripe geprüft.");
    if (p.get("refresh")) setNotice("Der Vorgang wurde abgebrochen. Sie können jederzeit fortfahren.");
    load();
  }, [load]);

  async function einrichten() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/connect", { method: "POST" });
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

  const c: Connect = data.connect ?? {};
  const bereit = !!c.chargesEnabled && !!c.payoutsEnabled;
  const begonnen = !!c.accountId;

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="sticky top-0 z-10 border-b border-ink-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Brand subtitle="Auszahlungskonto" />
          <Link href="/admin" className="text-sm font-bold text-ink-500 hover:text-ink-900">
            Zurück zum Dashboard
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-4xl gap-4 px-5 py-6">
        {notice && (
          <p data-testid="payout-notice" className="rounded-2xl bg-green-50 px-4 py-3 font-semibold text-green-800">
            {notice}
          </p>
        )}
        {error && (
          <p data-testid="payout-error" className="rounded-2xl bg-red-50 px-4 py-3 font-semibold text-red-700">
            {error}
          </p>
        )}

        {!data.stripeConfigured && (
          <p className="rounded-2xl bg-amber-50 px-4 py-3 font-semibold text-amber-800">
            Die Zahlungsanbindung ist auf diesem Server nicht eingerichtet. Kartenzahlung ist derzeit nicht möglich –
            Barfahrten laufen normal weiter.
          </p>
        )}

        {/* ---- Status ---------------------------------------------------- */}
        <section className="rounded-3xl border border-ink-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow text-ink-500">Status</p>
              <p data-testid="payout-status" className="mt-1 font-display text-xl font-extrabold text-ink-900">
                {bereit
                  ? "Auszahlungen aktiv"
                  : begonnen
                    ? "In Prüfung – Angaben unvollständig"
                    : "Noch kein Konto hinterlegt"}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-sm font-bold ${
                bereit ? "bg-green-100 text-green-800" : begonnen ? "bg-amber-100 text-amber-800" : "bg-ink-200 text-ink-700"
              }`}
            >
              {bereit ? "bereit" : begonnen ? "offen" : "nicht eingerichtet"}
            </span>
          </div>

          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-ink-400">Zahlungen empfangen</dt>
              <dd data-testid="payout-charges" className="font-bold text-ink-900">
                {c.chargesEnabled ? "ja" : "nein"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-ink-400">Auszahlung aufs Bankkonto</dt>
              <dd data-testid="payout-payouts" className="font-bold text-ink-900">
                {c.payoutsEnabled ? "ja" : "nein"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-ink-400">Unsere Provision</dt>
              <dd className="font-bold text-green-700">{data.commissionPercent ?? 0} %</dd>
            </div>
          </dl>

          {begonnen && !bereit && (c.requirementsDue?.length ?? 0) > 0 && (
            <div className="mt-4 rounded-2xl bg-amber-50 p-4">
              <p className="font-bold text-amber-900">Stripe fehlen noch folgende Angaben:</p>
              <ul data-testid="payout-requirements" className="mt-2 list-disc pl-5 text-sm text-amber-900">
                {c.requirementsDue.map((r) => (
                  <li key={r}>{nachweis(r)}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={einrichten}
              disabled={busy || !data.stripeConfigured}
              data-testid="payout-start"
              className="rounded-2xl bg-ink-900 px-5 py-3 font-bold text-white disabled:opacity-50"
            >
              {busy ? "Einen Moment …" : begonnen ? "Angaben vervollständigen" : "Auszahlungskonto einrichten"}
            </button>
            {data.dashboardUrl && (
              <a
                href={data.dashboardUrl}
                target="_blank"
                rel="noreferrer"
                data-testid="payout-dashboard"
                className="rounded-2xl border border-ink-200 px-5 py-3 font-bold text-ink-700 hover:bg-ink-50"
              >
                Auszahlungen bei Stripe ansehen
              </a>
            )}
            <button
              type="button"
              onClick={load}
              className="rounded-2xl border border-ink-200 px-5 py-3 font-bold text-ink-700 hover:bg-ink-50"
            >
              Status aktualisieren
            </button>
          </div>
        </section>

        {/* ---- Erklaerung ------------------------------------------------ */}
        <section className="rounded-3xl border border-ink-100 bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-extrabold text-ink-900">Wie das Geld fließt</h2>
          <ol className="mt-3 grid gap-3 text-sm text-ink-700">
            <li>
              <span className="font-bold text-ink-900">1. Fahrgast hinterlegt seine Karte.</span> Die Kartendaten liegen
              bei Stripe, nie bei uns und nie bei Ihnen.
            </li>
            <li>
              <span className="font-bold text-ink-900">2. Die Fahrt endet.</span> Der Fahrgast wählt Trinkgeld – oder
              lässt es weg – und der endgültige Betrag wird von der Karte eingezogen.
            </li>
            <li>
              <span className="font-bold text-ink-900">3. Das Geld geht direkt auf Ihr Konto.</span> Fahrpreis und
              Trinkgeld werden unmittelbar Ihrem Stripe-Konto gutgeschrieben; wir behalten nichts ein. Stripe zahlt von
              dort nach seinem üblichen Rhythmus auf Ihr Bankkonto aus.
            </li>
          </ol>
          <p className="mt-4 rounded-2xl bg-ink-50 p-4 text-sm text-ink-600">
            Solange kein Konto freigeschaltet ist, werden Kartenzahlungen über unser Plattform-Konto abgewickelt und
            müssen von Hand an Sie überwiesen werden. Barfahrten sind davon nie betroffen – dort kassiert der Fahrer wie
            gewohnt im Wagen. Das monatliche Abo ist von alldem getrennt und läuft über die{" "}
            <Link href="/admin/abo" className="font-bold text-ink-900 underline">
              Abo-Seite
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
