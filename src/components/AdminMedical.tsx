"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";

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
  const [authOk, setAuthOk] = useState(false);

  const loadDocs = () =>
    fetch("/api/medical/documents")
      .then((r) => { if (r.status === 401) { router.replace("/admin/login"); return null; } return r.json(); })
      .then((d) => { if (d) { setDocs(d.documents ?? []); setAuthOk(true); } })
      .catch(() => {});
  const loadLog = () => fetch("/api/admin/accesslog").then((r) => r.json()).then((d) => setLog(d.entries ?? [])).catch(() => {});

  useEffect(() => { loadDocs(); loadLog(); }, []);

  async function review(id: string, reviewStatus: string) {
    await fetch(`/api/medical/documents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewStatus }) });
    loadDocs(); loadLog();
  }

  if (!authOk) return <main className="grid min-h-screen place-items-center bg-ink-100 text-ink-500">Lädt …</main>;

  const pending = docs.filter((d) => d.reviewStatus === "PENDING");

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Brand href="/admin" subtitle="Krankenfahrten – Dokumente" />
          <Link href="/admin" data-testid="back-to-dashboard" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Dashboard</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-4xl gap-5 px-5 py-6">
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
