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

// Stripe nennt die offenen Punkte in technischer Form ("representative.dob.day").
// Fuer eine Zentrale ist das unbrauchbar, deshalb uebersetzen wir sie in
// Klartext und fassen zusammen, was ohnehin in einem Schritt erfasst wird:
// aus fuenfzehn kryptischen Zeilen werden so fuenf verstaendliche.
const NACHWEIS_REGELN: Array<[RegExp, string]> = [
  [/verification\.(document|additional_document)/, "Ausweisdokument zur Identitätsprüfung"],
  [/^external_account/, "Bankverbindung (IBAN) für die Auszahlung"],
  [/^business_profile/, "Angaben zum Unternehmen (Tätigkeit, Internetadresse)"],
  [/^business_type/, "Rechtsform (Einzelunternehmen, GmbH, …)"],
  [/^tos_acceptance/, "Zustimmung zu den Bedingungen von Stripe"],
  [/^(company|individual)\.(tax_id|vat_id)|^tax_id/, "Steuernummer bzw. Umsatzsteuer-Identifikationsnummer"],
  [/(representative|individual|person)\.address/, "Anschrift der vertretungsberechtigten Person"],
  [/(representative|individual|person)\.dob/, "Geburtsdatum der vertretungsberechtigten Person"],
  [
    /(representative|individual|person)\.(first_name|last_name|email|phone|title|relationship)/,
    "Name, E-Mail und Telefonnummer der vertretungsberechtigten Person",
  ],
  [/^company\.(name|address|phone)/, "Name und Anschrift des Unternehmens"],
];

function nachweis(key: string): string {
  for (const [muster, text] of NACHWEIS_REGELN) {
    if (muster.test(key)) return text;
  }
  return key;
}

// Mehrere Stripe-Punkte fallen oft auf denselben Klartext (Vorname, Nachname,
// E-Mail ...). Doppelte Zeilen waeren nur Rauschen.
function nachweisListe(keys: string[]): string[] {
  const gesehen: string[] = [];
  for (const k of keys) {
    const text = nachweis(k);
    if (!gesehen.includes(text)) gesehen.push(text);
  }
  return gesehen;
}

export function AdminPayout() {
  const [data, setData] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Ohne Anmeldung liefert die Schnittstelle 401. Wird das nicht behandelt,
  // steht die Seite fuer immer auf "Laedt ..." - ohne Meldung und ohne Ausweg.
  const [abgemeldet, setAbgemeldet] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/connect")
      .then(async (r) => {
        if (r.status === 401) {
          setAbgemeldet(true);
          return null;
        }
        if (!r.ok) {
          setError("Der Status konnte nicht geladen werden. Bitte später erneut versuchen.");
          return null;
        }
        return r.json();
      })
      .then((d) => d && setData(d))
      .catch(() => setError("Netzwerkfehler. Bitte prüfen Sie Ihre Verbindung."));
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

  if (abgemeldet) {
    return (
      <main className="grid min-h-screen place-items-center bg-ink-50 px-5">
        <div className="max-w-md text-center">
          <p className="font-display text-xl font-extrabold text-ink-900">Bitte melden Sie sich an</p>
          <p className="mt-2 text-ink-600">Das Auszahlungskonto sehen nur angemeldete Unternehmen.</p>
          <Link
            href="/admin/login"
            className="mt-5 inline-block rounded-2xl bg-ink-900 px-5 py-3 font-bold text-white"
          >
            Zur Anmeldung
          </Link>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-ink-50 px-5 text-center text-ink-500">
        {error ? <span className="font-semibold text-red-700">{error}</span> : "Lädt …"}
      </main>
    );
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
                {nachweisListe(c.requirementsDue).map((r) => (
                  <li key={r}>{r}</li>
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
