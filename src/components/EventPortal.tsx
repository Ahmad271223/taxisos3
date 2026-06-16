"use client";

import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { AddressInput } from "@/components/AddressInput";
import type { GeocodeResult } from "@/lib/geo";

interface Host { id: string; name: string; email: string }

export function EventPortal() {
  const [host, setHost] = useState<Host | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch("/api/events/me").then((r) => (r.ok ? r.json() : { host: null })).then((d) => setHost(d.host)).catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) return <main className="grid min-h-screen place-items-center bg-ink-50 text-ink-500">Lädt …</main>;
  if (!host) return <AuthScreen onAuthed={setHost} />;
  return <Dashboard host={host} onLogout={() => setHost(null)} />;
}

function AuthScreen({ onAuthed }: { onAuthed: (h: Host) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  async function submit() {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/events/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await res.json(); setBusy(false);
    if (!res.ok) return setErr(d.error ?? "Fehlgeschlagen.");
    const me = await fetch("/api/events/me").then((r) => r.json());
    if (me.host) onAuthed(me.host);
  }
  return (
    <main className="grid min-h-screen place-items-center bg-ink-50 px-5">
      <div className="card w-full max-w-md p-6">
        <Brand subtitle="Event-Portal" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => setMode("login")} className={`rounded-xl border-2 p-2 font-bold ${mode === "login" ? "border-brand-500 bg-brand-50" : "border-ink-200"}`}>Anmelden</button>
          <button onClick={() => setMode("register")} className={`rounded-xl border-2 p-2 font-bold ${mode === "register" ? "border-brand-500 bg-brand-50" : "border-ink-200"}`}>Registrieren</button>
        </div>
        <div className="mt-4 grid gap-2">
          {mode === "register" && <input className="field" placeholder="Veranstalter/Firma" data-testid="event-name" value={form.name} onChange={(e) => set("name", e.target.value)} />}
          <input className="field" type="email" placeholder="E-Mail" data-testid="event-email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          <input className="field" type="password" placeholder="Passwort" data-testid="event-password" value={form.password} onChange={(e) => set("password", e.target.value)} />
          {err && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" data-testid="event-auth-error">{err}</p>}
          <button onClick={submit} disabled={busy} data-testid="event-auth-submit" className="btn-primary disabled:opacity-60">{busy ? "…" : mode === "login" ? "Anmelden" : "Konto erstellen"}</button>
        </div>
      </div>
    </main>
  );
}

function Dashboard({ host, onLogout }: { host: Host; onLogout: () => void }) {
  const [promos, setPromos] = useState<any[]>([]);
  const load = useCallback(() => fetch("/api/events/promos").then((r) => r.json()).then((d) => setPromos(d.promos ?? [])).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Brand subtitle={`Event · ${host.name}`} />
          <button onClick={async () => { await fetch("/api/auth/logout?scope=event", { method: "POST" }).catch(() => {}); onLogout(); }} className="text-sm font-bold text-ink-500 hover:text-ink-900">Abmelden</button>
        </div>
      </header>
      <div className="mx-auto grid max-w-3xl gap-4 px-5 py-6">
        <NewPromoCard onCreated={load} />
        <PromoListCard promos={promos} />
        <ZonesCard />
      </div>
    </main>
  );
}

function NewPromoCard({ onCreated }: { onCreated: () => void }) {
  const empty = { code: "", label: "", discountType: "PERCENT", discountValue: "10", validUntil: "", maxUses: "" };
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));
  async function create() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/events/promos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code, label: form.label || null, discountType: form.discountType,
        discountValue: Number(form.discountValue), validUntil: form.validUntil || null,
        maxUses: form.maxUses ? Number(form.maxUses) : null,
      }),
    });
    const d = await res.json(); setBusy(false);
    if (!res.ok) return setMsg(d.error ?? "Fehlgeschlagen.");
    setMsg(`✓ Code ${d.promo.code} erstellt.`); setForm(empty); onCreated();
  }
  return (
    <div className="card p-6">
      <h2 className="mb-3 font-display text-lg font-extrabold text-ink-900">Promo-Code anlegen</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="field uppercase" data-testid="promo-code" placeholder="Code (z. B. IAA2026)" value={form.code} onChange={(e) => set("code", e.target.value.toUpperCase())} />
        <input className="field" placeholder="Beschreibung (optional)" value={form.label} onChange={(e) => set("label", e.target.value)} />
        <select className="field" data-testid="promo-type" value={form.discountType} onChange={(e) => set("discountType", e.target.value)}>
          <option value="PERCENT">Prozent-Rabatt (%)</option>
          <option value="FIXED">Fester Betrag (€)</option>
        </select>
        <input className="field" type="number" data-testid="promo-value" placeholder="Wert" value={form.discountValue} onChange={(e) => set("discountValue", e.target.value)} />
        <label className="grid gap-1 text-xs text-ink-500">Gültig bis (optional)<input className="field" type="date" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} /></label>
        <label className="grid gap-1 text-xs text-ink-500">Max. Einlösungen (optional)<input className="field" type="number" value={form.maxUses} onChange={(e) => set("maxUses", e.target.value)} /></label>
      </div>
      {msg && <p className="mt-2 text-sm font-semibold text-ink-700" data-testid="promo-msg">{msg}</p>}
      <button onClick={create} disabled={busy || !form.code.trim()} data-testid="promo-save" className="btn-primary mt-3 disabled:opacity-60">{busy ? "…" : "Code erstellen"}</button>
    </div>
  );
}

function ZonesCard() {
  const [zones, setZones] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [center, setCenter] = useState<{ address: string; lat?: number; lng?: number }>({ address: "" });
  const [radius, setRadius] = useState("300");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetch("/api/events/zones").then((r) => r.json()).then((d) => setZones(d.zones ?? [])).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const ok = name.trim() && center.lat != null && !busy;
  async function add() {
    setBusy(true);
    const res = await fetch("/api/events/zones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, lat: center.lat, lng: center.lng, radiusMeters: Number(radius) || 300 }) });
    setBusy(false);
    if (res.ok) { setName(""); setCenter({ address: "" }); setRadius("300"); load(); }
  }
  return (
    <div className="card p-6" data-testid="event-zones">
      <h2 className="mb-1 font-display text-lg font-extrabold text-ink-900">Geo-Sammelpunkte</h2>
      <p className="mb-3 text-xs text-ink-500">Virtuelle Taxistände für dein Event: Abholungen im Radius werden automatisch auf den Sammelpunkt gelenkt (verhindert Chaos/Stau).</p>
      <div className="grid gap-2">
        <input className="field" data-testid="zone-name" placeholder="Name (z. B. Messe Nord – Halle 9)" value={name} onChange={(e) => setName(e.target.value)} />
        <AddressInput label="Sammelpunkt" placeholder="Adresse des Treffpunkts" value={center.address} onChange={(t) => setCenter({ address: t })} onSelect={(r: GeocodeResult) => setCenter({ address: r.label, lat: r.lat, lng: r.lng })} />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="grid gap-1 text-xs text-ink-500">Radius (Meter)<input className="field" type="number" value={radius} onChange={(e) => setRadius(e.target.value)} /></label>
          <button onClick={add} disabled={!ok} data-testid="zone-save" className="btn-primary self-end disabled:opacity-60">{busy ? "…" : "Sammelpunkt anlegen"}</button>
        </div>
      </div>
      <div className="mt-3 grid gap-2">
        {zones.map((z) => (
          <div key={z.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2 text-sm" data-testid={`zone-${z.id}`}>
            <span className="font-bold text-ink-900">📍 {z.name}</span>
            <span className="text-xs text-ink-500">Radius {z.radiusMeters} m</span>
          </div>
        ))}
        {zones.length === 0 && <p className="text-sm text-ink-400">Noch keine Sammelpunkte.</p>}
      </div>
    </div>
  );
}

function PromoListCard({ promos }: { promos: any[] }) {
  return (
    <div className="card p-6">
      <h2 className="mb-3 font-display text-lg font-extrabold text-ink-900">Promo-Codes ({promos.length})</h2>
      <div className="grid gap-2">
        {promos.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2 text-sm" data-testid={`promo-${p.code}`}>
            <span className="min-w-0">
              <span className="font-mono font-extrabold tracking-wider text-ink-900">{p.code}</span>
              <span className="ml-2 text-ink-600">{p.discountType === "FIXED" ? `${p.discountValue} €` : `${p.discountValue} %`}{p.label ? ` · ${p.label}` : ""}</span>
            </span>
            <span className="shrink-0 text-xs text-ink-500">{p.usedCount}{p.maxUses ? `/${p.maxUses}` : ""} eingelöst</span>
          </div>
        ))}
        {promos.length === 0 && <p className="text-sm text-ink-400">Noch keine Codes.</p>}
      </div>
    </div>
  );
}
