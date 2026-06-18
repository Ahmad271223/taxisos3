"use client";

import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { AddressInput } from "@/components/AddressInput";
import type { GeocodeResult } from "@/lib/geo";
import { SupportCard } from "@/components/SupportCard";
import { PortalUsersCard } from "@/components/PortalUsersCard";
import { VEHICLE_CLASSES } from "@/lib/vehicleClasses";

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
        <EventsCard />
        <NewPromoCard onCreated={load} />
        <PromoListCard promos={promos} onChanged={load} />
        <ZonesCard />
        <CorporateCard />
        <PortalUsersCard />
        <SupportCard />
      </div>
    </main>
  );
}

// Veranstaltungen: Metadaten + Gästeliste + Shuttle-Zeiten.
function EventsCard() {
  const [events, setEvents] = useState<any[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const empty = { name: "", contactName: "", contactPhone: "", eventDate: "", location: "", expectedGuests: "" };
  const [form, setForm] = useState<any>(empty);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));
  const load = useCallback(() => fetch("/api/events/list").then((r) => r.json()).then((d) => setEvents(d.events ?? [])).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!form.name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/events/list", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, contactName: form.contactName || null, contactPhone: form.contactPhone || null, eventDate: form.eventDate || null, location: form.location || null, expectedGuests: form.expectedGuests ? Number(form.expectedGuests) : null }),
    });
    setBusy(false);
    if (res.ok) { const d = await res.json(); setForm(empty); setOpen(false); setSelId(d.event.id); load(); }
  }
  async function remove(ev: any) {
    if (!window.confirm(`Event „${ev.name}" mit Gästeliste und Shuttles löschen?`)) return;
    await fetch(`/api/events/list/${ev.id}`, { method: "DELETE" }).catch(() => {});
    if (selId === ev.id) setSelId(null);
    load();
  }
  const selected = events.find((e) => e.id === selId);

  return (
    <div className="card p-6" data-testid="event-events">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-display text-lg font-extrabold text-ink-900">Veranstaltungen</h2>
        <button onClick={() => setOpen((o) => !o)} className="text-sm font-bold text-brand-700 hover:underline">{open ? "Schließen" : "+ Neues Event"}</button>
      </div>
      <p className="mb-3 text-xs text-ink-500">Metadaten, Gästeliste und Shuttle-Zeiten je Veranstaltung (Hochzeit, Messe, Konferenz …).</p>
      {open && (
        <div className="mb-4 grid gap-2 rounded-2xl border border-ink-100 p-3 sm:grid-cols-2">
          <input className="field sm:col-span-2" data-testid="event-name-field" placeholder="Eventname *" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <input className="field" placeholder="Ansprechpartner" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
          <input className="field" placeholder="Telefon" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
          <label className="grid gap-1 text-xs text-ink-500">Eventdatum<input className="field" type="date" value={form.eventDate} onChange={(e) => set("eventDate", e.target.value)} /></label>
          <label className="grid gap-1 text-xs text-ink-500">Erwartete Gäste<input className="field" type="number" value={form.expectedGuests} onChange={(e) => set("expectedGuests", e.target.value)} /></label>
          <input className="field sm:col-span-2" placeholder="Veranstaltungsort" value={form.location} onChange={(e) => set("location", e.target.value)} />
          <button onClick={create} disabled={busy || !form.name.trim()} data-testid="event-create" className="btn-primary sm:col-span-2 disabled:opacity-60">{busy ? "…" : "Event anlegen"}</button>
        </div>
      )}
      <div className="grid gap-2">
        {events.map((ev) => (
          <div key={ev.id} className={`rounded-xl border px-3 py-2 ${selId === ev.id ? "border-brand-400 bg-brand-50" : "border-ink-100 bg-ink-50"}`} data-testid={`event-${ev.id}`}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <button onClick={() => setSelId(selId === ev.id ? null : ev.id)} className="min-w-0 text-left">
                <span className="font-bold text-ink-900">{ev.name}</span>
                <span className="block text-xs text-ink-500">{[ev.eventDate, ev.location, ev.expectedGuests != null && `${ev.expectedGuests} Gäste`].filter(Boolean).join(" · ")}</span>
                <span className="block text-[11px] text-ink-400">{ev._count?.guests ?? 0} Gäste · {ev._count?.shuttles ?? 0} Shuttles</span>
              </button>
              <button onClick={() => remove(ev)} className="shrink-0 text-xs font-bold text-red-600 hover:underline">Löschen</button>
            </div>
            {selId === ev.id && <EventDetail event={ev} onChanged={load} />}
          </div>
        ))}
        {events.length === 0 && <p className="text-sm text-ink-400">Noch keine Veranstaltungen.</p>}
      </div>
    </div>
  );
}

function EventDetail({ event, onChanged }: { event: any; onChanged: () => void }) {
  const [guests, setGuests] = useState<any[]>([]);
  const [shuttles, setShuttles] = useState<any[]>([]);
  const loadG = useCallback(() => fetch(`/api/events/guests?eventId=${event.id}`).then((r) => r.json()).then((d) => setGuests(d.guests ?? [])).catch(() => {}), [event.id]);
  const loadS = useCallback(() => fetch(`/api/events/shuttles?eventId=${event.id}`).then((r) => r.json()).then((d) => setShuttles(d.shuttles ?? [])).catch(() => {}), [event.id]);
  useEffect(() => { loadG(); loadS(); }, [loadG, loadS]);

  const [g, setG] = useState<any>({ name: "", phone: "", groupName: "", hotel: "", destAddress: "", isVip: false, requirements: "" });
  const setGf = (k: string, v: any) => setG((f: any) => ({ ...f, [k]: v }));
  async function addGuest() {
    if (!g.name.trim()) return;
    await fetch("/api/events/guests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: event.id, ...g, phone: g.phone || null, groupName: g.groupName || null, hotel: g.hotel || null, destAddress: g.destAddress || null, requirements: g.requirements || null }) }).catch(() => {});
    setG({ name: "", phone: "", groupName: "", hotel: "", destAddress: "", isVip: false, requirements: "" }); loadG(); onChanged();
  }
  async function delGuest(id: string) { await fetch(`/api/events/guests/${id}`, { method: "DELETE" }).catch(() => {}); loadG(); onChanged(); }

  const [s, setS] = useState<any>({ label: "", fromAddress: "", toAddress: "", time: "", vehicleClass: "", seats: "" });
  const [series, setSeries] = useState({ start: "", end: "", interval: "30" });
  const setSf = (k: string, v: any) => setS((f: any) => ({ ...f, [k]: v }));
  async function postShuttle(time: string) {
    return fetch("/api/events/shuttles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: event.id, label: s.label, fromAddress: s.fromAddress || null, toAddress: s.toAddress || null, time, vehicleClass: s.vehicleClass || null, seats: s.seats ? Number(s.seats) : null }) }).catch(() => {});
  }
  async function addShuttle() {
    if (!s.label.trim() || !/^\d{2}:\d{2}$/.test(s.time)) return;
    await postShuttle(s.time); setS({ ...s, time: "" }); loadS(); onChanged();
  }
  async function addSeries() {
    if (!s.label.trim() || !/^\d{2}:\d{2}$/.test(series.start) || !/^\d{2}:\d{2}$/.test(series.end)) return;
    const iv = Math.max(5, Number(series.interval) || 30);
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    for (let m = toMin(series.start); m <= toMin(series.end); m += iv) await postShuttle(fmt(m));
    loadS(); onChanged();
  }
  async function delShuttle(id: string) { await fetch(`/api/events/shuttles/${id}`, { method: "DELETE" }).catch(() => {}); loadS(); onChanged(); }

  return (
    <div className="mt-3 grid gap-4 border-t border-ink-200 pt-3">
      {/* Gästeliste */}
      <div>
        <p className="eyebrow mb-2 text-ink-400">Gästeliste ({guests.length})</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <input className="field" data-testid="guest-name-field" placeholder="Name *" value={g.name} onChange={(e) => setGf("name", e.target.value)} />
          <input className="field" placeholder="Telefon" value={g.phone} onChange={(e) => setGf("phone", e.target.value)} />
          <input className="field" placeholder="Gruppe" value={g.groupName} onChange={(e) => setGf("groupName", e.target.value)} />
          <input className="field" placeholder="Hotel" value={g.hotel} onChange={(e) => setGf("hotel", e.target.value)} />
          <input className="field" placeholder="Ziel" value={g.destAddress} onChange={(e) => setGf("destAddress", e.target.value)} />
          <label className="flex items-center gap-2 rounded-xl border-2 border-ink-200 bg-white px-3 text-sm font-semibold text-ink-700"><input type="checkbox" className="h-5 w-5 accent-brand-500" checked={g.isVip} onChange={(e) => setGf("isVip", e.target.checked)} />⭐ VIP</label>
          <input className="field sm:col-span-2" placeholder="Besondere Anforderungen" value={g.requirements} onChange={(e) => setGf("requirements", e.target.value)} />
          <button onClick={addGuest} disabled={!g.name.trim()} data-testid="guest-add" className="btn-primary sm:col-span-2 disabled:opacity-60">Gast hinzufügen</button>
        </div>
        <div className="mt-2 grid gap-1">
          {guests.map((x) => (
            <div key={x.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1 text-xs">
              <span className="min-w-0 truncate"><span className="font-bold text-ink-900">{x.name}</span>{x.isVip && " ⭐"} {[x.groupName, x.hotel, x.destAddress && `→ ${x.destAddress}`].filter(Boolean).join(" · ")}</span>
              <button onClick={() => delGuest(x.id)} className="shrink-0 font-bold text-red-600">×</button>
            </div>
          ))}
        </div>
      </div>
      {/* Shuttle-Zeiten */}
      <div>
        <p className="eyebrow mb-2 text-ink-400">Shuttle-Zeiten ({shuttles.length})</p>
        <input className="field mb-1.5" data-testid="shuttle-label" placeholder="Bezeichnung, z. B. Hotel A → Messe *" value={s.label} onChange={(e) => setSf("label", e.target.value)} />
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <input className="field" placeholder="Von" value={s.fromAddress} onChange={(e) => setSf("fromAddress", e.target.value)} />
          <input className="field" placeholder="Nach" value={s.toAddress} onChange={(e) => setSf("toAddress", e.target.value)} />
          <select className="field" value={s.vehicleClass} onChange={(e) => setSf("vehicleClass", e.target.value)}><option value="">Fahrzeug …</option>{VEHICLE_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}</select>
          <input className="field" type="number" placeholder="Plätze" value={s.seats} onChange={(e) => setSf("seats", e.target.value)} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          <label className="grid gap-0.5 text-[11px] text-ink-500">Einzel-Zeit<input className="field" type="time" data-testid="shuttle-time" value={s.time} onChange={(e) => setSf("time", e.target.value)} /></label>
          <button onClick={addShuttle} data-testid="shuttle-add" className="btn-dark text-sm">+ Slot</button>
          <span className="text-ink-300">|</span>
          <label className="grid gap-0.5 text-[11px] text-ink-500">Serie von<input className="field" type="time" value={series.start} onChange={(e) => setSeries((x) => ({ ...x, start: e.target.value }))} /></label>
          <label className="grid gap-0.5 text-[11px] text-ink-500">bis<input className="field" type="time" value={series.end} onChange={(e) => setSeries((x) => ({ ...x, end: e.target.value }))} /></label>
          <label className="grid gap-0.5 text-[11px] text-ink-500">alle (Min)<input className="field w-20" type="number" value={series.interval} onChange={(e) => setSeries((x) => ({ ...x, interval: e.target.value }))} /></label>
          <button onClick={addSeries} data-testid="shuttle-series" className="btn-ghost text-sm">+ Serie</button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {shuttles.map((x) => (
            <span key={x.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-bold text-ink-800 ring-1 ring-ink-200">
              {x.time} {x.label}<button onClick={() => delShuttle(x.id)} className="text-red-600">×</button>
            </span>
          ))}
        </div>
      </div>
    </div>
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
      <ZoneList zones={zones} onChanged={load} />
    </div>
  );
}

function ZoneList({ zones, onChanged }: { zones: any[]; onChanged: () => void }) {
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [radius, setRadius] = useState("300");
  const [center, setCenter] = useState<{ address: string; lat?: number; lng?: number }>({ address: "" });
  const [busy, setBusy] = useState(false);

  function startEdit(z: any) { setEditId(z.id); setName(z.name); setRadius(String(z.radiusMeters)); setCenter({ address: "" }); }
  async function patch(id: string, body: any) {
    setBusy(true);
    await fetch(`/api/events/zones/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    setBusy(false); onChanged();
  }
  async function saveEdit(id: string) {
    const body: any = { name, radiusMeters: Number(radius) || 300 };
    if (center.lat != null && center.lng != null) { body.lat = center.lat; body.lng = center.lng; }
    await patch(id, body); setEditId(null);
  }
  async function remove(z: any) {
    if (!window.confirm(`Sammelpunkt „${z.name}" wirklich löschen?`)) return;
    setBusy(true);
    await fetch(`/api/events/zones/${z.id}`, { method: "DELETE" }).catch(() => {});
    setBusy(false); onChanged();
  }

  return (
    <div className="mt-3 grid gap-2">
      {zones.map((z) => {
        const editing = editId === z.id;
        return (
          <div key={z.id} className={`rounded-xl border px-3 py-2 text-sm ${z.active ? "border-ink-100 bg-ink-50" : "border-ink-200 bg-white opacity-60"}`} data-testid={`zone-${z.id}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-ink-900">📍 {z.name}{!z.active && <span className="ml-2 rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-bold text-ink-600">Pausiert</span>}</span>
              <span className="shrink-0 text-xs text-ink-500">Radius {z.radiusMeters} m</span>
            </div>
            <div className="mt-1 flex justify-end">
              <ManageButtons active={z.active} editing={editing} testidBase={`zone-${z.id}`} onToggle={() => patch(z.id, { active: !z.active })} onEdit={() => (editing ? setEditId(null) : startEdit(z))} onDelete={() => remove(z)} />
            </div>
            {editing && (
              <div className="mt-2 grid gap-2 border-t border-ink-100 pt-2">
                <input className="field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                <AddressInput label="Punkt verschieben (optional)" placeholder="Neue Adresse – leer lassen, um Position zu behalten" value={center.address} onChange={(t) => setCenter({ address: t })} onSelect={(r: GeocodeResult) => setCenter({ address: r.label, lat: r.lat, lng: r.lng })} />
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <label className="grid gap-1 text-xs text-ink-500">Radius (Meter)<input className="field" type="number" value={radius} onChange={(e) => setRadius(e.target.value)} /></label>
                  <button onClick={() => saveEdit(z.id)} disabled={busy || !name.trim()} data-testid={`zone-${z.id}-save`} className="btn-primary self-end disabled:opacity-60">Speichern</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {zones.length === 0 && <p className="text-sm text-ink-400">Noch keine Sammelpunkte.</p>}
    </div>
  );
}

function euro(cents: number) {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

// Lädt die QR-Lib erst bei Bedarf clientseitig (kein externer Dienst, kein Leak).
function QrImage({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    import("qrcode").then((QR) => QR.toDataURL(url, { width: 240, margin: 1 }).then((d) => { if (on) setSrc(d); })).catch(() => {});
    return () => { on = false; };
  }, [url]);
  if (!src) return <div className="grid h-[240px] w-[240px] place-items-center rounded-xl bg-ink-50 text-xs text-ink-400">QR …</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="QR-Code" width={240} height={240} className="rounded-xl border border-ink-100" />;
}

function CorporateCard() {
  const [codes, setCodes] = useState<any[]>([]);
  const [form, setForm] = useState({ label: "", budgetEuro: "", maxRides: "", perRideEuro: "", validUntil: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [eform, setEform] = useState<any>({});
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setE = (k: string, v: string) => setEform((f: any) => ({ ...f, [k]: v }));
  const load = useCallback(() => fetch("/api/events/corporate").then((r) => r.json()).then((d) => setCodes(d.codes ?? [])).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  function startEdit(c: any) {
    setEditId(c.id);
    setEform({
      label: c.label ?? "",
      budgetEuro: c.budgetCents != null ? String(c.budgetCents / 100) : "",
      maxRides: c.maxRides != null ? String(c.maxRides) : "",
      perRideEuro: c.perRideCents != null ? String(c.perRideCents / 100) : "",
      validUntil: c.validUntil ?? "",
    });
  }
  async function patch(id: string, body: any) {
    setBusy(true);
    await fetch(`/api/events/corporate/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    setBusy(false); load();
  }
  async function saveEdit(id: string) {
    await patch(id, {
      label: eform.label || null,
      budgetEuro: eform.budgetEuro ? Number(eform.budgetEuro) : null,
      maxRides: eform.maxRides ? Number(eform.maxRides) : null,
      perRideEuro: eform.perRideEuro ? Number(eform.perRideEuro) : null,
      validUntil: eform.validUntil || null,
    });
    setEditId(null);
  }
  async function remove(c: any) {
    if (!window.confirm(`QR-Code ${c.code} wirklich löschen? Bereits gebuchte Fahrten bleiben erhalten.`)) return;
    setBusy(true);
    await fetch(`/api/events/corporate/${c.id}`, { method: "DELETE" }).catch(() => {});
    setBusy(false); load();
  }

  async function create() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/events/corporate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: form.label || null,
        budgetEuro: form.budgetEuro ? Number(form.budgetEuro) : null,
        maxRides: form.maxRides ? Number(form.maxRides) : null,
        perRideEuro: form.perRideEuro ? Number(form.perRideEuro) : null,
        validUntil: form.validUntil || null,
      }),
    });
    const d = await res.json(); setBusy(false);
    if (!res.ok) return setMsg(d.error ?? "Fehlgeschlagen.");
    setMsg(`✓ Code ${d.code.code} erstellt.`); setForm({ label: "", budgetEuro: "", maxRides: "", perRideEuro: "", validUntil: "" }); setOpenId(d.code.id); load();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="card p-6" data-testid="event-corporate">
      <h2 className="mb-1 font-display text-lg font-extrabold text-ink-900">Firmenmobilität · QR-Codes</h2>
      <p className="mb-3 text-xs text-ink-500">Gib einen QR-Code aus (Einladung, Badge, Aushang). Wer ihn scannt, bucht Fahrten, die euer Firmenkonto übernimmt – gedeckelt über Budget, Anzahl und Max-Betrag pro Fahrt.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="field sm:col-span-2" data-testid="corp-label" placeholder="Bezeichnung (z. B. Gäste IAA 2026)" value={form.label} onChange={(e) => set("label", e.target.value)} />
        <label className="grid gap-1 text-xs text-ink-500">Gesamtbudget € (optional)<input className="field" type="number" data-testid="corp-budget" placeholder="z. B. 2000" value={form.budgetEuro} onChange={(e) => set("budgetEuro", e.target.value)} /></label>
        <label className="grid gap-1 text-xs text-ink-500">Max. Fahrten (optional)<input className="field" type="number" data-testid="corp-maxrides" placeholder="z. B. 100" value={form.maxRides} onChange={(e) => set("maxRides", e.target.value)} /></label>
        <label className="grid gap-1 text-xs text-ink-500">Max. € pro Fahrt (optional)<input className="field" type="number" data-testid="corp-perride" placeholder="z. B. 60" value={form.perRideEuro} onChange={(e) => set("perRideEuro", e.target.value)} /></label>
        <label className="grid gap-1 text-xs text-ink-500">Gültig bis (optional)<input className="field" type="date" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} /></label>
      </div>
      {msg && <p className="mt-2 text-sm font-semibold text-ink-700" data-testid="corp-msg">{msg}</p>}
      <button onClick={create} disabled={busy} data-testid="corp-save" className="btn-primary mt-3 disabled:opacity-60">{busy ? "…" : "QR-Code erstellen"}</button>

      <div className="mt-4 grid gap-2">
        {codes.map((c) => {
          const link = `${origin}/m/${c.code}`;
          const open = openId === c.id;
          return (
            <div key={c.id} className={`rounded-xl border p-3 ${c.active ? "border-ink-100 bg-ink-50" : "border-ink-200 bg-white opacity-70"}`} data-testid={`corp-${c.code}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-mono text-base font-extrabold tracking-widest text-ink-900">{c.code}</span>
                  {c.label && <span className="ml-2 text-sm text-ink-600">{c.label}</span>}
                  {!c.active && <span className="ml-2 rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-bold text-ink-600">Pausiert</span>}
                </span>
                <button onClick={() => setOpenId(open ? null : c.id)} className="shrink-0 text-sm font-bold text-brand-700 hover:underline">{open ? "Schließen" : "QR anzeigen"}</button>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-500">
                <span>Fahrten: {c.usedRides}{c.maxRides ? ` / ${c.maxRides}` : " (unbegrenzt)"}</span>
                <span>Budget: {euro(c.usedCents)}{c.budgetCents != null ? ` / ${euro(c.budgetCents)}` : " (unbegrenzt)"}</span>
                {c.perRideCents != null && <span>max. {euro(c.perRideCents)}/Fahrt</span>}
                {c.validUntil && <span>gültig bis {c.validUntil}</span>}
              </div>
              <div className="mt-1 flex justify-end">
                <ManageButtons active={c.active} editing={editId === c.id} testidBase={`corp-${c.code}`} onToggle={() => patch(c.id, { active: !c.active })} onEdit={() => (editId === c.id ? setEditId(null) : startEdit(c))} onDelete={() => remove(c)} />
              </div>
              {editId === c.id && (
                <div className="mt-2 grid gap-2 border-t border-ink-100 pt-2 sm:grid-cols-2">
                  <input className="field sm:col-span-2" placeholder="Bezeichnung" value={eform.label} onChange={(e) => setE("label", e.target.value)} />
                  <label className="grid gap-1 text-xs text-ink-500">Gesamtbudget €<input className="field" type="number" value={eform.budgetEuro} onChange={(e) => setE("budgetEuro", e.target.value)} /></label>
                  <label className="grid gap-1 text-xs text-ink-500">Max. Fahrten<input className="field" type="number" value={eform.maxRides} onChange={(e) => setE("maxRides", e.target.value)} /></label>
                  <label className="grid gap-1 text-xs text-ink-500">Max. € pro Fahrt<input className="field" type="number" value={eform.perRideEuro} onChange={(e) => setE("perRideEuro", e.target.value)} /></label>
                  <label className="grid gap-1 text-xs text-ink-500">Gültig bis<input className="field" type="date" value={eform.validUntil} onChange={(e) => setE("validUntil", e.target.value)} /></label>
                  <button onClick={() => saveEdit(c.id)} disabled={busy} data-testid={`corp-${c.code}-save`} className="btn-primary self-end disabled:opacity-60 sm:col-span-2">Speichern</button>
                </div>
              )}
              {open && (
                <div className="mt-3 grid place-items-center gap-2">
                  <QrImage url={link} />
                  <div className="flex w-full items-center gap-2">
                    <input readOnly className="field flex-1 text-xs" value={link} onFocus={(e) => e.currentTarget.select()} />
                    <button onClick={() => navigator.clipboard?.writeText(link).catch(() => {})} className="btn-ghost shrink-0 text-sm">Link kopieren</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {codes.length === 0 && <p className="text-sm text-ink-400">Noch keine QR-Codes.</p>}
      </div>

      <div className="mt-5 border-t border-ink-100 pt-4">
        <h3 className="font-display text-sm font-extrabold text-ink-900">Monats-Abrechnung</h3>
        <p className="mb-2 text-xs text-ink-500">Alle über eure QR-Codes übernommenen Fahrten eines Monats als PDF.</p>
        <div className="flex items-center gap-2">
          <input className="field" type="month" data-testid="corp-stmt-month" value={month} onChange={(e) => setMonth(e.target.value)} />
          <a href={`/api/events/corporate/statement?month=${month}`} target="_blank" rel="noopener noreferrer" data-testid="corp-stmt-download" className="btn-ghost shrink-0 text-sm">PDF</a>
          <a href={`/api/events/corporate/statement?month=${month}&format=csv`} data-testid="corp-stmt-csv" className="btn-ghost shrink-0 text-sm">CSV</a>
        </div>
      </div>
    </div>
  );
}

// Geteilte Verwaltungs-Buttons (Pausieren/Aktivieren · Bearbeiten · Löschen).
function ManageButtons({ active, editing, onToggle, onEdit, onDelete, testidBase }: {
  active: boolean; editing: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void; testidBase?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button onClick={onToggle} data-testid={testidBase ? `${testidBase}-toggle` : undefined} className="rounded-lg px-2 py-1 text-xs font-bold text-ink-600 hover:bg-ink-100">{active ? "Pausieren" : "Aktivieren"}</button>
      <button onClick={onEdit} data-testid={testidBase ? `${testidBase}-edit` : undefined} className="rounded-lg px-2 py-1 text-xs font-bold text-brand-700 hover:bg-brand-50">{editing ? "Schließen" : "Bearbeiten"}</button>
      <button onClick={onDelete} data-testid={testidBase ? `${testidBase}-delete` : undefined} className="rounded-lg px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50">Löschen</button>
    </div>
  );
}

function PromoListCard({ promos, onChanged }: { promos: any[]; onChanged: () => void }) {
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const setF = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  function startEdit(p: any) {
    setEditId(p.id);
    setForm({ label: p.label ?? "", discountType: p.discountType, discountValue: String(p.discountValue), validUntil: p.validUntil ?? "", maxUses: p.maxUses != null ? String(p.maxUses) : "" });
  }
  async function patch(id: string, body: any) {
    setBusy(true);
    await fetch(`/api/events/promos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    setBusy(false); onChanged();
  }
  async function saveEdit(id: string) {
    await patch(id, { label: form.label || null, discountType: form.discountType, discountValue: Number(form.discountValue), validUntil: form.validUntil || null, maxUses: form.maxUses ? Number(form.maxUses) : null });
    setEditId(null);
  }
  async function remove(p: any) {
    if (!window.confirm(`Promo-Code ${p.code} wirklich löschen?`)) return;
    setBusy(true);
    await fetch(`/api/events/promos/${p.id}`, { method: "DELETE" }).catch(() => {});
    setBusy(false); onChanged();
  }

  return (
    <div className="card p-6">
      <h2 className="mb-3 font-display text-lg font-extrabold text-ink-900">Promo-Codes ({promos.length})</h2>
      <div className="grid gap-2">
        {promos.map((p) => {
          const editing = editId === p.id;
          return (
            <div key={p.id} className={`rounded-xl border px-3 py-2 text-sm ${p.active ? "border-ink-100 bg-ink-50" : "border-ink-200 bg-white opacity-60"}`} data-testid={`promo-${p.code}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="font-mono font-extrabold tracking-wider text-ink-900">{p.code}</span>
                  <span className="ml-2 text-ink-600">{p.discountType === "FIXED" ? `${p.discountValue} €` : `${p.discountValue} %`}{p.label ? ` · ${p.label}` : ""}</span>
                  {!p.active && <span className="ml-2 rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-bold text-ink-600">Pausiert</span>}
                </span>
                <span className="shrink-0 text-xs text-ink-500">{p.usedCount}{p.maxUses ? `/${p.maxUses}` : ""} eingelöst</span>
              </div>
              <div className="mt-1 flex justify-end">
                <ManageButtons active={p.active} editing={editing} testidBase={`promo-${p.code}`} onToggle={() => patch(p.id, { active: !p.active })} onEdit={() => (editing ? setEditId(null) : startEdit(p))} onDelete={() => remove(p)} />
              </div>
              {editing && (
                <div className="mt-2 grid gap-2 border-t border-ink-100 pt-2 sm:grid-cols-2">
                  <input className="field" placeholder="Beschreibung" value={form.label} onChange={(e) => setF("label", e.target.value)} />
                  <select className="field" value={form.discountType} onChange={(e) => setF("discountType", e.target.value)}>
                    <option value="PERCENT">Prozent (%)</option>
                    <option value="FIXED">Fester Betrag (€)</option>
                  </select>
                  <input className="field" type="number" placeholder="Wert" value={form.discountValue} onChange={(e) => setF("discountValue", e.target.value)} />
                  <label className="grid gap-1 text-xs text-ink-500">Gültig bis<input className="field" type="date" value={form.validUntil} onChange={(e) => setF("validUntil", e.target.value)} /></label>
                  <label className="grid gap-1 text-xs text-ink-500">Max. Einlösungen<input className="field" type="number" value={form.maxUses} onChange={(e) => setF("maxUses", e.target.value)} /></label>
                  <button onClick={() => saveEdit(p.id)} disabled={busy} data-testid={`promo-${p.code}-save`} className="btn-primary self-end disabled:opacity-60">Speichern</button>
                </div>
              )}
            </div>
          );
        })}
        {promos.length === 0 && <p className="text-sm text-ink-400">Noch keine Codes.</p>}
      </div>
    </div>
  );
}
