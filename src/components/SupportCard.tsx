"use client";

import { useCallback, useEffect, useState } from "react";

export const SUPPORT_CATEGORIES: { key: string; label: string }[] = [
  { key: "DRIVER_NO_SHOW", label: "Fahrer nicht gekommen" },
  { key: "GUEST_NOT_FOUND", label: "Gast nicht gefunden" },
  { key: "WRONG_VEHICLE", label: "Falsches Fahrzeug" },
  { key: "WRONG_INVOICE", label: "Rechnung falsch" },
  { key: "BAD_BEHAVIOR", label: "Verhalten schlecht" },
  { key: "OTHER", label: "Sonstiges" },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(SUPPORT_CATEGORIES.map((c) => [c.key, c.label]));

const STATUS_CFG: Record<string, { cls: string; txt: string }> = {
  OPEN: { cls: "bg-amber-100 text-amber-800", txt: "Offen" },
  IN_PROGRESS: { cls: "bg-brand-100 text-ink-900", txt: "In Bearbeitung" },
  RESOLVED: { cls: "bg-green-100 text-green-800", txt: "Gelöst" },
  CLOSED: { cls: "bg-ink-200 text-ink-600", txt: "Geschlossen" },
};

// Beschwerde-/Support-Karte für B2B-Portale (Hotel/Event/Einrichtung).
export function SupportCard() {
  const [tickets, setTickets] = useState<any[]>([]);
  const empty = { category: "DRIVER_NO_SHOW", subject: "", message: "", bookingId: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const load = useCallback(() => fetch("/api/support/tickets").then((r) => (r.ok ? r.json() : { tickets: [] })).then((d) => setTickets(d.tickets ?? [])).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  async function submit() {
    if (!form.subject.trim() || !form.message.trim()) return;
    setBusy(true);
    const res = await fetch("/api/support/tickets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: form.category, subject: form.subject, message: form.message, bookingId: form.bookingId || null }),
    });
    setBusy(false);
    if (res.ok) { setForm(empty); setOpen(false); load(); }
  }

  return (
    <div className="card p-6" data-testid="support-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-extrabold text-ink-900">Beschwerden &amp; Support</h2>
        <button onClick={() => setOpen((o) => !o)} className="text-sm font-bold text-brand-700 hover:underline">{open ? "Schließen" : "+ Neue Meldung"}</button>
      </div>
      {open && (
        <div className="mb-4 grid gap-2 rounded-2xl border border-ink-100 p-3">
          <select className="field" data-testid="support-category" value={form.category} onChange={(e) => set("category", e.target.value)}>
            {SUPPORT_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <input className="field" data-testid="support-subject" placeholder="Betreff *" value={form.subject} onChange={(e) => set("subject", e.target.value)} />
          <textarea className="field" rows={3} data-testid="support-message" placeholder="Was ist passiert? *" value={form.message} onChange={(e) => set("message", e.target.value)} />
          <input className="field" placeholder="Auftragsnummer (optional)" value={form.bookingId} onChange={(e) => set("bookingId", e.target.value)} />
          <button onClick={submit} disabled={busy || !form.subject.trim() || !form.message.trim()} data-testid="support-submit" className="btn-primary disabled:opacity-60">{busy ? "…" : "Meldung senden"}</button>
        </div>
      )}
      <div className="grid gap-2">
        {tickets.map((t) => {
          const s = STATUS_CFG[t.status] ?? STATUS_CFG.OPEN;
          return (
            <div key={t.id} className="rounded-xl bg-ink-50 px-3 py-2 text-sm" data-testid={`ticket-${t.id}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-bold text-ink-900">{t.subject}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${s.cls}`}>{s.txt}</span>
              </div>
              <p className="text-xs text-ink-500">{CAT_LABEL[t.category] ?? t.category}{t.bookingId ? ` · #${String(t.bookingId).slice(-8)}` : ""}</p>
              {t.adminNote && <p className="mt-1 rounded bg-white px-2 py-1 text-xs text-ink-700"><span className="font-bold">Antwort:</span> {t.adminNote}</p>}
            </div>
          );
        })}
        {tickets.length === 0 && <p className="text-sm text-ink-400">Keine Meldungen.</p>}
      </div>
    </div>
  );
}
