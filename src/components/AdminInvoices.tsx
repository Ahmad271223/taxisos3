"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { formatEuro } from "@/lib/format";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function dmy(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

export function AdminInvoices() {
  const router = useRouter();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    (m: string) => {
      setLoading(true);
      setError(null);
      fetch(`/api/admin/invoices/${m}?format=json`)
        .then((r) => {
          if (r.status === 401) {
            router.replace("/admin/login");
            return null;
          }
          return r.json();
        })
        .then((d) => {
          if (!d) return;
          if (d.error) setError(d.error);
          else setData(d);
        })
        .catch(() => setError("Laden fehlgeschlagen."))
        .finally(() => setLoading(false));
    },
    [router],
  );

  useEffect(() => {
    load(month);
  }, [month, load]);

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Brand href="/admin" subtitle="Monatsumsatz" />
          <Link href="/admin" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Dashboard</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 px-5 py-6">
        <div className="card flex flex-wrap items-end justify-between gap-4 p-5">
          <div>
            <label className="label" htmlFor="month">Abrechnungsmonat</label>
            <input
              id="month"
              type="month"
              data-testid="invoice-month"
              className="field"
              value={month}
              max={currentMonth()}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/admin/invoices/${month}`}
              data-testid="invoice-download"
              className={`btn-primary ${!data || data.trips === 0 ? "pointer-events-none opacity-50" : ""}`}
            >
              Monatsübersicht als PDF
            </a>
          </div>
        </div>
        {loading && <div className="card p-6 text-center text-ink-500">Lädt …</div>}
        {error && !loading && (
          <div className="card p-6 text-center font-semibold text-red-600" data-testid="invoice-error">{error}</div>
        )}

        {data && !loading && !error && (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {/* (A) Firma ↔ Kunden: Umsatz aus Fahrten und Netto-Auszahlung an die Firma. */}
            <div className="card p-6" data-testid="revenue-overview">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 pb-4">
              <div>
                <p className="eyebrow text-ink-500">Kundenumsatz &amp; Auszahlung</p>
                <p className="font-display text-xl font-extrabold text-ink-900">{data.recipient.name}</p>
                <p className="text-sm text-ink-500">Zeitraum: {data.periodLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-ink-400">Netto-Verdienst</p>
                <p className="font-display text-2xl font-extrabold text-green-700" data-testid="revenue-payout">{formatEuro(data.grossRevenue)}</p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="py-2 pr-2">Datum</th>
                    <th className="py-2 pr-2">Fahrt</th>
                    <th className="py-2 text-right">Fahrpreis (Ihr Anteil)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.length === 0 ? (
                    <tr><td colSpan={3} className="py-6 text-center text-ink-400">Keine abgeschlossenen Fahrten in diesem Monat.</td></tr>
                  ) : (
                    data.lines.map((l: any, i: number) => (
                      <tr key={i} className="border-b border-ink-50">
                        <td className="py-1.5 pr-2 text-ink-600">{dmy(l.date)}</td>
                        <td className="py-1.5 pr-2 text-ink-700">{l.route}</td>
                        <td className="py-1.5 text-right font-semibold text-green-700">{formatEuro(l.fare)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid justify-end gap-1 text-sm">
              <div className="flex justify-between gap-12">
                <span className="text-ink-500">Bruttoumsatz (Fahrgäste)</span>
                <span className="font-semibold" data-testid="revenue-gross">{formatEuro(data.grossRevenue)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-12 border-t border-ink-200 pt-2">
                <span className="font-bold text-ink-900">Davon behalten Sie</span>
                <span className="font-display text-lg font-extrabold text-green-700">{formatEuro(data.grossRevenue)}</span>
              </div>
            </div>

            <p className="mt-4 text-xs text-ink-400">
              Auf einzelne Fahrten fällt <strong>keine Provision</strong> an – der volle Fahrpreis
              gehört Ihnen. Kartenzahlungen gehen direkt auf Ihr Auszahlungskonto. Ihre einzige
              Gebühr ist das Monats-Abo; Rechnungen dazu finden Sie unter{" "}
              <Link href="/admin/abo" className="font-bold text-ink-700 underline">Abo &amp; Rechnungen</Link>.
            </p>
            </div>
            {/*
              Der frühere Block "Gebühren-Rechnung (Plattform-Provision)" ist
              entfallen: es gibt keine Provision pro Fahrt mehr. Abgerechnet
              wird ausschliesslich das Monats-Abo (siehe /admin/abo).
            */}
            <div className="card p-6" data-testid="fee-info">
              <p className="eyebrow text-ink-500">Ihre Gebühren</p>
              <p className="mt-1 font-display text-xl font-extrabold text-ink-900">Monats-Abo statt Provision</p>
              <p className="mt-3 text-sm text-ink-600">
                Von jeder Fahrt behalten Sie <strong>100 % des Fahrpreises</strong>. Die Plattform
                berechnet keine Vermittlungsgebühr je Fahrt – Sie zahlen nur einen festen
                Monatsbeitrag, abhängig von der Zahl Ihrer Fahrer.
              </p>
              <Link href="/admin/abo" className="btn-primary mt-4 w-fit" data-testid="fee-info-link">
                Abo &amp; Rechnungen ansehen
              </Link>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
