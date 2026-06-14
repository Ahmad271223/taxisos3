"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEuro } from "@/lib/format";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
function dmy(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE");
}

type Filter = "all" | "OFFEN" | "BEZAHLT" | "overdue";

// Rechnungs-Archiv + Zahlungsabgleich + Mahnwesen (Phase 6, Super-Admin).
export function SuperInvoiceArchive() {
  const [data, setData] = useState<{ invoices: any[]; totals: any } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [issueMonth, setIssueMonth] = useState(currentMonth());
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = filter === "overdue" ? "?overdue=1" : filter === "all" ? "" : `?status=${filter}`;
    fetch(`/api/super/invoices${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function issueAll() {
    setBusy("issue");
    setMsg(null);
    try {
      const r = await fetch("/api/super/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue-all", month: issueMonth }),
      });
      const d = await r.json();
      setMsg(r.ok ? `${d.issued} neu festgeschrieben, ${d.existing} bereits vorhanden, ${d.skipped} ohne Umsatz.` : d.error ?? "Fehler");
    } catch {
      setMsg("Netzwerkfehler.");
    } finally {
      setBusy(null);
      load();
    }
  }

  async function remindOverdue() {
    if (!confirm("Mahnung an alle überfälligen Rechnungen senden?")) return;
    setBusy("remind");
    setMsg(null);
    try {
      const r = await fetch("/api/super/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remind-overdue" }),
      });
      const d = await r.json();
      setMsg(r.ok ? `${d.reminded}/${d.attempted} Mahnungen versendet${d.mock ? " (Mock-Modus)" : ""}.` : "Fehler");
    } catch {
      setMsg("Netzwerkfehler.");
    } finally {
      setBusy(null);
      load();
    }
  }

  async function rowAction(id: string, action: "pay" | "unpaid" | "remind") {
    setBusy(id + action);
    try {
      const ref = action === "pay" ? prompt("Zahlungsreferenz (optional):") ?? undefined : undefined;
      await fetch(`/api/super/invoices/id/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ref }),
      });
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
      load();
    }
  }

  const invoices = data?.invoices ?? [];
  const totals = data?.totals;

  return (
    <div className="card p-6" data-testid="super-invoice-archive">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-100 pb-4">
        <div>
          <p className="eyebrow text-ink-500">Rechnungs-Archiv</p>
          <h2 className="font-display text-xl font-extrabold text-ink-900">Status &amp; Zahlungsabgleich</h2>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="issue-month">Monat festschreiben</label>
            <input id="issue-month" type="month" className="field" value={issueMonth} max={currentMonth()} onChange={(e) => setIssueMonth(e.target.value)} />
          </div>
          <button type="button" onClick={issueAll} disabled={busy === "issue"} data-testid="issue-all" className="btn-ghost disabled:opacity-50">
            {busy === "issue" ? "…" : "Alle festschreiben"}
          </button>
          <button type="button" onClick={remindOverdue} disabled={busy === "remind"} data-testid="remind-overdue" className="btn-primary disabled:opacity-50">
            {busy === "remind" ? "…" : "Mahnlauf (überfällig)"}
          </button>
        </div>
      </div>

      {totals && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="Rechnungen" value={totals.count} />
          <Mini label="Offen" value={formatEuro(totals.open)} />
          <Mini label="Überfällig" value={`${formatEuro(totals.overdue)} (${totals.overdueCount})`} accent />
          <Mini label="Bezahlt" value={formatEuro(totals.paid)} />
        </div>
      )}

      {msg && <div className="mt-3 rounded-xl bg-ink-50 p-3 text-sm font-semibold text-ink-800" data-testid="archive-msg">{msg}</div>}

      <div className="mt-4 flex gap-2 text-xs">
        {(["all", "OFFEN", "overdue", "BEZAHLT"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 font-bold ${filter === f ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-600"}`}
          >
            {f === "all" ? "Alle" : f === "OFFEN" ? "Offen" : f === "overdue" ? "Überfällig" : "Bezahlt"}
          </button>
        ))}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
              <th className="py-2 pr-2">Nr. / Firma</th>
              <th className="py-2 pr-2">Zeitraum</th>
              <th className="py-2 pr-2 text-right">Brutto</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2">Fällig</th>
              <th className="py-2 text-right">Aktion</th>
            </tr>
          </thead>
          <tbody data-testid="archive-rows">
            {invoices.length === 0 ? (
              <tr><td colSpan={6} className="py-6 text-center text-ink-400">Keine Rechnungen.</td></tr>
            ) : (
              invoices.map((inv: any) => (
                <tr key={inv.id} className="border-b border-ink-50">
                  <td className="py-2 pr-2">
                    <p className="font-mono text-xs text-ink-600">{inv.invoiceNo}</p>
                    <p className="font-semibold text-ink-800">{inv.company?.name ?? inv.companyId}</p>
                  </td>
                  <td className="py-2 pr-2">{inv.periodLabel}</td>
                  <td className="py-2 pr-2 text-right font-semibold">{formatEuro(inv.gross)}</td>
                  <td className="py-2 pr-2">
                    <Badge inv={inv} />
                    {inv.remindersSent > 0 && <span className="ml-1 text-[10px] text-ink-400">{inv.remindersSent}×</span>}
                  </td>
                  <td className="py-2 pr-2 text-ink-500">{dmy(inv.dueAt)}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <a href={`/api/admin/invoices/id/${inv.id}`} className="text-xs font-bold text-ink-500 hover:text-ink-900">PDF</a>
                      {inv.status === "BEZAHLT" ? (
                        <button type="button" onClick={() => rowAction(inv.id, "unpaid")} className="text-xs font-bold text-ink-500 hover:text-ink-900">
                          zurücksetzen
                        </button>
                      ) : (
                        <>
                          <button type="button" onClick={() => rowAction(inv.id, "pay")} data-testid={`pay-${inv.id}`} className="text-xs font-bold text-green-700 hover:text-green-900">
                            bezahlt
                          </button>
                          <button type="button" onClick={() => rowAction(inv.id, "remind")} data-testid={`remind-${inv.id}`} className="text-xs font-bold text-red-600 hover:text-red-800">
                            mahnen
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${accent ? "bg-red-50 text-red-800" : "bg-ink-50 text-ink-900"}`}>
      <p className={`text-[11px] font-bold uppercase tracking-wide ${accent ? "text-red-700/70" : "text-ink-500"}`}>{label}</p>
      <p className="mt-1 font-display text-lg font-extrabold">{value}</p>
    </div>
  );
}

function Badge({ inv }: { inv: any }) {
  const { label, cls } =
    inv.status === "BEZAHLT"
      ? { label: "Bezahlt", cls: "bg-green-100 text-green-800" }
      : inv.overdue
      ? { label: "Überfällig", cls: "bg-red-100 text-red-700" }
      : inv.status === "STORNIERT"
      ? { label: "Storniert", cls: "bg-ink-100 text-ink-600" }
      : { label: "Offen", cls: "bg-brand-100 text-ink-900" };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${cls}`}>{label}</span>;
}
