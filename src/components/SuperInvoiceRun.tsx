"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEuro } from "@/lib/format";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// Sammel-Abrechnung (Phase 5): Vorschau aller Mandanten, ZIP-Download, E-Mail-Versand.
export function SuperInvoiceRun() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<any | null>(null);

  const load = useCallback((m: string) => {
    setLoading(true);
    setSendResult(null);
    fetch(`/api/super/invoices/${m}?format=json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(month);
  }, [month, load]);

  async function sendAll() {
    if (!confirm(`Allen Firmen mit Provision die Rechnung für ${month} per E-Mail senden?`)) return;
    setSending(true);
    setSendResult(null);
    try {
      const r = await fetch(`/api/super/invoices/${month}/send`, { method: "POST" });
      setSendResult(await r.json());
    } catch {
      setSendResult({ error: "Netzwerkfehler." });
    } finally {
      setSending(false);
    }
  }

  const billable = data?.billable ?? 0;

  return (
    <div className="card p-6" data-testid="super-invoice-run">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-100 pb-4">
        <div>
          <p className="eyebrow text-ink-500">Sammel-Abrechnung</p>
          <h2 className="font-display text-xl font-extrabold text-ink-900">Provisions-Rechnungen je Monat</h2>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="run-month">Monat</label>
            <input
              id="run-month"
              type="month"
              data-testid="run-month"
              className="field"
              value={month}
              max={currentMonth()}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <a
            href={`/api/super/invoices/${month}`}
            data-testid="run-zip"
            className={`btn-ghost ${billable === 0 ? "pointer-events-none opacity-50" : ""}`}
          >
            ZIP herunterladen
          </a>
          <button
            type="button"
            onClick={sendAll}
            disabled={sending || billable === 0}
            data-testid="run-send-all"
            className="btn-primary disabled:opacity-50"
          >
            {sending ? "Versende …" : "Alle per E-Mail senden"}
          </button>
        </div>
      </div>

      {loading && <p className="py-4 text-center text-ink-500">Lädt …</p>}

      {data && !loading && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Firmen" value={data.companies} />
            <Mini label="Abrechenbar (>0)" value={billable} />
            <Mini label="Provision netto" value={formatEuro(data.totals.net)} />
            <Mini label="Brutto inkl. USt" value={formatEuro(data.totals.gross)} accent />
          </div>

          {sendResult && (
            <div className="mt-4 rounded-xl bg-ink-50 p-3 text-sm" data-testid="run-send-result">
              {sendResult.error ? (
                <span className="font-bold text-red-600">{sendResult.error}</span>
              ) : (
                <span className="font-semibold text-ink-800">
                  {sendResult.sent}/{sendResult.attempted} Rechnungen versendet
                  {sendResult.failed ? `, ${sendResult.failed} fehlgeschlagen` : ""}
                  {sendResult.mock ? " · Mock-Modus (kein Resend-Key gesetzt)" : ""}.
                </span>
              )}
            </div>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-2">Firma</th>
                  <th className="py-2 pr-2 text-right">Fahrten</th>
                  <th className="py-2 pr-2 text-right">Netto</th>
                  <th className="py-2 pr-2 text-right">USt</th>
                  <th className="py-2 text-right">Brutto</th>
                </tr>
              </thead>
              <tbody data-testid="run-rows">
                {data.rows.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-ink-400">Keine Mandanten.</td></tr>
                ) : (
                  data.rows.map((r: any) => (
                    <tr key={r.slug} className={`border-b border-ink-50 ${r.net === 0 ? "text-ink-400" : ""}`}>
                      <td className="py-1.5 pr-2">
                        <span className="font-semibold text-ink-800">{r.company}</span>
                        <span className="ml-1 text-xs text-ink-400">/c/{r.slug}</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right">{r.trips}</td>
                      <td className="py-1.5 pr-2 text-right">{formatEuro(r.net)}</td>
                      <td className="py-1.5 pr-2 text-right">{formatEuro(r.vat)}</td>
                      <td className="py-1.5 text-right font-semibold">{formatEuro(r.gross)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${accent ? "bg-brand-500 text-ink-900" : "bg-ink-50 text-ink-900"}`}>
      <p className={`text-[11px] font-bold uppercase tracking-wide ${accent ? "text-ink-900/70" : "text-ink-500"}`}>{label}</p>
      <p className="mt-1 font-display text-lg font-extrabold">{value}</p>
    </div>
  );
}
