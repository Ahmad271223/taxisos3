"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { formatEuro } from "@/lib/format";

const KIND_LABEL: Record<string, string> = {
  VERORDNUNG: "Verordnung", GENEHMIGUNG: "Genehmigung", REZEPT: "Rezept", BESCHEINIGUNG: "Bescheinigung",
};
const STATUS_STYLE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800", APPROVED: "bg-green-100 text-green-800", REJECTED: "bg-red-100 text-red-700",
};

export function AdminMedical() {
  const router = useRouter();
  const [docs, setDocs] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [dash, setDash] = useState<any | null>(null);
  const [authOk, setAuthOk] = useState(false);

  const loadDocs = () =>
    fetch("/api/medical/documents")
      .then((r) => { if (r.status === 401) { router.replace("/admin/login"); return null; } return r.json(); })
      .then((d) => { if (d) { setDocs(d.documents ?? []); setAuthOk(true); } })
      .catch(() => {});
  const loadLog = () => fetch("/api/admin/accesslog").then((r) => r.json()).then((d) => setLog(d.entries ?? [])).catch(() => {});
  const loadDash = () => fetch("/api/admin/medical/dashboard").then((r) => (r.ok ? r.json() : null)).then((d) => d && setDash(d)).catch(() => {});

  useEffect(() => { loadDocs(); loadLog(); loadDash(); }, []);

  async function review(id: string, reviewStatus: string) {
    await fetch(`/api/medical/documents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewStatus }) });
    loadDocs(); loadLog(); loadDash();
  }

  if (!authOk) return <main className="grid min-h-screen place-items-center bg-ink-100 text-ink-500">Lädt …</main>;

  const pending = docs.filter((d) => d.reviewStatus === "PENDING");

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <Brand href="/admin" subtitle="Krankenfahrten-Center" />
          <Link href="/admin" data-testid="back-to-dashboard" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Dashboard</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-5 px-5 py-6">
        {dash && (
          <section className="card p-6" data-testid="medical-dashboard">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-extrabold text-ink-900">Übersicht · {dash.monthLabel}</h2>
              <span className="rounded-full bg-ink-900 px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-brand-500">LIVE</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Heute" value={dash.kpis.today} />
              <Kpi label="In Bearbeitung" value={dash.kpis.inProgress} />
              <Kpi label="Abgeschlossen" value={dash.kpis.completedThisMonth} />
              <Kpi label="Umsatz" value={formatEuro(dash.kpis.revenueThisMonth)} accent />
              <Kpi label="Offene Dok." value={dash.kpis.pendingDocs} warn={dash.kpis.pendingDocs > 0} />
              <Kpi label="Serienfahrten" value={dash.kpis.activeSeries} />
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Breakdown title="Nach Krankenkasse" rows={dash.byPayer} empty="Noch keine Krankenfahrten" />
              <Breakdown title="Nach Einrichtung" rows={dash.byInstitution} empty="Keine Einrichtungsfahrten" />
              <Breakdown title="Nach Fahrtart" rows={(dash.byType ?? []).map((t: any) => ({ name: t.label, count: t.count }))} empty="Noch keine Krankenfahrten" noRevenue />
            </div>
          </section>
        )}

        <BillingSection />

        <section className="card p-6">
          <h2 className="mb-3 font-display text-lg font-extrabold text-ink-900">Dokumentenprüfung ({pending.length} offen)</h2>
          <div className="grid gap-2" data-testid="doc-list">
            {docs.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2.5" data-testid={`doc-${d.id}`}>
                <div className="min-w-0">
                  <p className="truncate font-bold text-ink-900">{KIND_LABEL[d.kind] ?? d.kind} · {d.fileName}</p>
                  <p className="text-xs text-ink-500">{new Date(d.createdAt).toLocaleString("de-DE")}{d.bookingId ? ` · Buchung ${d.bookingId.slice(0, 6)}` : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${STATUS_STYLE[d.reviewStatus] ?? "bg-ink-100 text-ink-600"}`}>{d.reviewStatus}</span>
                  <a href={`/api/medical/documents/${d.id}`} target="_blank" rel="noreferrer" data-testid={`doc-open-${d.id}`} className="rounded-lg bg-ink-100 px-2.5 py-1.5 text-xs font-bold text-ink-700 hover:bg-ink-200">Öffnen</a>
                  <button onClick={() => review(d.id, "APPROVED")} data-testid={`doc-approve-${d.id}`} className="rounded-lg bg-green-500 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-green-600">Genehmigen</button>
                  <button onClick={() => review(d.id, "REJECTED")} data-testid={`doc-reject-${d.id}`} className="rounded-lg bg-red-500 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-red-600">Ablehnen</button>
                </div>
              </div>
            ))}
            {docs.length === 0 && <p className="text-sm text-ink-400">Noch keine Dokumente hochgeladen.</p>}
          </div>
        </section>

        <section className="card p-6">
          <h2 className="mb-3 font-display text-lg font-extrabold text-ink-900">Zugriffsprotokoll (DSGVO)</h2>
          <div className="grid gap-1.5 text-xs" data-testid="accesslog">
            {log.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-3 py-1.5">
                <span className="font-mono text-ink-500">{new Date(e.at).toLocaleString("de-DE")}</span>
                <span className="font-bold text-ink-900">{e.actorType} · {e.action}</span>
                <span className="truncate text-ink-500">{e.entity}{e.detail ? ` · ${e.detail}` : ""}</span>
              </div>
            ))}
            {log.length === 0 && <p className="text-sm text-ink-400">Noch keine Zugriffe protokolliert.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

function Kpi({ label, value, accent, warn }: { label: string; value: React.ReactNode; accent?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${accent ? "bg-ink-900" : warn ? "bg-amber-50 ring-1 ring-amber-200" : "bg-ink-50"}`}>
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${accent ? "text-white/60" : "text-ink-400"}`}>{label}</p>
      <p className={`font-display text-xl font-extrabold ${accent ? "text-brand-500" : warn ? "text-amber-700" : "text-ink-900"}`}>{value}</p>
    </div>
  );
}

function BillingSection() {
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    fetch(`/api/admin/medical/billing?month=${month}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
  }, [month]);

  return (
    <section className="card p-6" data-testid="medical-billing">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold text-ink-900">Krankenkassen-Abrechnung</h2>
        <div className="flex items-center gap-2">
          <input className="field max-w-[160px]" type="month" value={month} data-testid="billing-month" onChange={(e) => setMonth(e.target.value)} />
          <a href={`/api/admin/medical/billing?month=${month}&format=csv`} data-testid="billing-csv" className="shrink-0 rounded-xl bg-ink-900 px-3 py-2.5 text-sm font-extrabold text-white transition hover:bg-ink-800">CSV-Export</a>
        </div>
      </div>
      {data && (
        <>
          <div className="grid gap-2">
            {(data.groups ?? []).map((g: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2.5">
                <span className="min-w-0 truncate font-bold text-ink-900">{g.payer}</span>
                <span className="shrink-0 text-sm text-ink-600">{g.count} Fahrten · {g.km} km · <span className="font-extrabold text-ink-900">{formatEuro(g.fare)}</span></span>
              </div>
            ))}
            {(data.groups ?? []).length === 0 && <p className="text-sm text-ink-400">Keine abgeschlossenen Krankenfahrten in {data.periodLabel}.</p>}
          </div>
          {data.total?.count > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-ink-200 pt-3 text-sm">
              <span className="font-bold text-ink-900">Gesamt · {data.periodLabel}</span>
              <span className="text-ink-600">{data.total.count} Fahrten · {data.total.km} km · <span className="font-display text-lg font-extrabold text-ink-900">{formatEuro(data.total.fare)}</span></span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Breakdown({ title, rows, empty, noRevenue }: { title: string; rows: any[]; empty?: string; noRevenue?: boolean }) {
  return (
    <div className="rounded-2xl bg-ink-50 p-4">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{title}</p>
      <div className="grid gap-1.5">
        {(!rows || rows.length === 0) ? (
          <p className="text-xs text-ink-400">{empty ?? "Keine Daten"}</p>
        ) : (
          rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate text-ink-700">{r.name}</span>
              <span className="shrink-0 font-bold text-ink-900">
                {r.count}
                {!noRevenue && r.revenue ? <span className="text-ink-500"> · {formatEuro(r.revenue)}</span> : null}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
