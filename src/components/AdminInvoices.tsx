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
  const [emailing, setEmailing] = useState(false);
  const [emailMsg, setEmailMsg] = useState<string | null>(null);
  const [archive, setArchive] = useState<any[]>([]);
  const [issuing, setIssuing] = useState(false);

  const loadArchive = useCallback(() => {
    fetch("/api/admin/invoices")
      .then((r) => (r.ok ? r.json() : { invoices: [] }))
      .then((d) => setArchive(d.invoices ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadArchive();
  }, [loadArchive]);

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
    setEmailMsg(null);
    load(month);
  }, [month, load]);

  async function issueInvoice() {
    setIssuing(true);
    setEmailMsg(null);
    try {
      const r = await fetch(`/api/admin/invoices/${month}/issue`, { method: "POST" });
      const d = await r.json();
      if (r.ok) {
        setEmailMsg(d.created ? "Rechnung festgeschrieben und archiviert." : "Rechnung war bereits festgeschrieben.");
        loadArchive();
      } else {
        setEmailMsg(d.error ?? "Festschreiben fehlgeschlagen.");
      }
    } catch {
      setEmailMsg("Netzwerkfehler.");
    } finally {
      setIssuing(false);
    }
  }

  async function sendByEmail() {
    setEmailing(true);
    setEmailMsg(null);
    try {
      const r = await fetch(`/api/admin/invoices/${month}/send`, { method: "POST" });
      const d = await r.json();
      if (r.ok && d.ok) {
        setEmailMsg(d.mock ? `Versand simuliert (kein Resend-Key) – Ziel: ${d.to}` : `Rechnung an ${d.to} gesendet.`);
      } else {
        setEmailMsg(d.error ?? "Versand fehlgeschlagen.");
      }
    } catch {
      setEmailMsg("Netzwerkfehler.");
    } finally {
      setEmailing(false);
    }
  }

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Brand href="/admin" subtitle="Provisions-Abrechnung" />
          <Link href="/admin" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Dashboard</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-3xl gap-4 px-5 py-6">
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
            <button
              type="button"
              onClick={issueInvoice}
              disabled={issuing || !data || data.trips === 0}
              data-testid="invoice-issue"
              className="btn-ghost disabled:opacity-50"
            >
              {issuing ? "Schreibe fest …" : "Festschreiben"}
            </button>
            <button
              type="button"
              onClick={sendByEmail}
              disabled={emailing || !data || data.trips === 0}
              data-testid="invoice-email"
              className="btn-ghost disabled:opacity-50"
            >
              {emailing ? "Sende …" : "Per E-Mail senden"}
            </button>
            <a
              href={`/api/admin/invoices/${month}`}
              data-testid="invoice-download"
              className={`btn-primary ${!data || data.trips === 0 ? "pointer-events-none opacity-50" : ""}`}
            >
              PDF herunterladen
            </a>
          </div>
        </div>
        {emailMsg && (
          <div className="card px-4 py-2 text-sm font-semibold text-ink-700" data-testid="invoice-email-msg">{emailMsg}</div>
        )}

        {loading && <div className="card p-6 text-center text-ink-500">Lädt …</div>}
        {error && !loading && (
          <div className="card p-6 text-center font-semibold text-red-600" data-testid="invoice-error">{error}</div>
        )}

        {data && !loading && !error && (
          <div className="card p-6" data-testid="invoice-preview">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ink-100 pb-4">
              <div>
                <p className="eyebrow text-ink-500">Rechnung</p>
                <p className="font-display text-xl font-extrabold text-ink-900" data-testid="invoice-no">{data.invoiceNo}</p>
                <p className="text-sm text-ink-500">Zeitraum: {data.periodLabel}</p>
              </div>
              <div className="text-right text-sm text-ink-600">
                <p className="font-bold text-ink-900">{data.recipient.name}</p>
                <p>{data.recipient.address}</p>
                <p>Tarifstufe {data.recipient.cityTier} · {data.recipient.ratePct} %</p>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="py-2 pr-2">Datum</th>
                    <th className="py-2 pr-2">Fahrt</th>
                    <th className="py-2 pr-2 text-right">Fahrpreis</th>
                    <th className="py-2 pr-2 text-right">Satz</th>
                    <th className="py-2 text-right">Gebühr</th>
                  </tr>
                </thead>
                <tbody data-testid="invoice-lines">
                  {data.lines.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-ink-400">
                        Keine abgeschlossenen Fahrten in diesem Monat.
                      </td>
                    </tr>
                  ) : (
                    data.lines.map((l: any, i: number) => (
                      <tr key={i} className="border-b border-ink-50">
                        <td className="py-1.5 pr-2 text-ink-600">{dmy(l.date)}</td>
                        <td className="py-1.5 pr-2 text-ink-700">{l.route}</td>
                        <td className="py-1.5 pr-2 text-right">{formatEuro(l.fare)}</td>
                        <td className="py-1.5 pr-2 text-right text-ink-500">{Math.round(l.rate * 100)} %</td>
                        <td className="py-1.5 text-right font-semibold">{formatEuro(l.fee)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid justify-end gap-1 text-sm">
              <div className="flex justify-between gap-12">
                <span className="text-ink-500">Zwischensumme (netto)</span>
                <span data-testid="invoice-net" className="font-semibold">{formatEuro(data.net)}</span>
              </div>
              <div className="flex justify-between gap-12">
                <span className="text-ink-500">zzgl. USt {Math.round(data.vatRate * 100)} %</span>
                <span data-testid="invoice-vat">{formatEuro(data.vat)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-12 border-t border-ink-200 pt-2">
                <span className="font-bold text-ink-900">Gesamtbetrag</span>
                <span data-testid="invoice-gross" className="font-display text-lg font-extrabold text-ink-900">{formatEuro(data.gross)}</span>
              </div>
            </div>

            <p className="mt-4 text-xs text-ink-400">
              {data.trips} abgerechnete Fahrt(en) · Bruttoumsatz {formatEuro(data.grossRevenue)}. Leistung: Vermittlungsgebühr der Plattform.
            </p>
          </div>
        )}

        {/* Archiv (Phase 6) */}
        {archive.length > 0 && (
          <div className="card p-6" data-testid="invoice-archive">
            <h2 className="mb-3 eyebrow text-ink-500">Archiv – festgeschriebene Rechnungen</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                    <th className="py-2 pr-2">Nr.</th>
                    <th className="py-2 pr-2">Zeitraum</th>
                    <th className="py-2 pr-2 text-right">Brutto</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Fällig</th>
                    <th className="py-2 text-right">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {archive.map((inv) => (
                    <tr key={inv.id} className="border-b border-ink-50" data-testid={`archive-row-${inv.monthKey}`}>
                      <td className="py-1.5 pr-2 font-mono text-xs text-ink-600">{inv.invoiceNo}</td>
                      <td className="py-1.5 pr-2">{inv.periodLabel}</td>
                      <td className="py-1.5 pr-2 text-right font-semibold">{formatEuro(inv.gross)}</td>
                      <td className="py-1.5 pr-2"><StatusBadge inv={inv} /></td>
                      <td className="py-1.5 pr-2 text-ink-500">{new Date(inv.dueAt).toLocaleDateString("de-DE")}</td>
                      <td className="py-1.5 text-right">
                        <a href={`/api/admin/invoices/id/${inv.id}`} className="font-bold text-ink-700 hover:text-ink-900">PDF</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ inv }: { inv: any }) {
  const { label, cls } =
    inv.status === "BEZAHLT"
      ? { label: "Bezahlt", cls: "bg-green-100 text-green-800" }
      : inv.overdue
      ? { label: inv.remindersSent > 0 ? `Mahnung ${inv.remindersSent}` : "Überfällig", cls: "bg-red-100 text-red-700" }
      : inv.status === "STORNIERT"
      ? { label: "Storniert", cls: "bg-ink-100 text-ink-600" }
      : { label: "Offen", cls: "bg-brand-100 text-ink-900" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${cls}`}>{label}</span>;
}
