"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { AddressInput } from "@/components/AddressInput";
import type { GeocodeResult } from "@/lib/geo";

const FIXED_CLASSES = [
  { key: "ALL", label: "Alle Klassen" },
  { key: "STANDARD", label: "Standard" },
  { key: "BUSINESS", label: "Business" },
  { key: "VAN", label: "Van" },
  { key: "SHUTTLE", label: "Shuttle" },
  { key: "VIP", label: "VIP" },
  { key: "WHEELCHAIR", label: "Rollstuhl" },
];

const FIELDS: { key: string; label: string; suffix: string; step?: string }[] = [
  { key: "perKmDay", label: "Preis pro km · Tag (06:00–22:00)", suffix: "€ / km", step: "0.10" },
  { key: "perKmNight", label: "Preis pro km · Nacht (22:00–06:00)", suffix: "€ / km", step: "0.10" },
  { key: "perKmWeekend", label: "Preis pro km · Wochenende (Sa/So)", suffix: "€ / km", step: "0.10" },
  { key: "perMinute", label: "Preis pro Minute (optional)", suffix: "€ / min", step: "0.05" },
  { key: "basePrice", label: "Grundpreis", suffix: "€", step: "0.10" },
  { key: "fixedBufferPct", label: "Dynamischer Festpreis-Buffer (0 = aus)", suffix: "%", step: "1" },
  { key: "perStopFee", label: "Aufschlag je Zwischenstopp", suffix: "€ / Stopp", step: "0.50" },
  { key: "noShowFee", label: "No-Show-Gebühr (Gast nicht erschienen)", suffix: "€", step: "1" },
  { key: "cancelFee", label: "Storno-Gebühr (nach Fahrer-Zuweisung)", suffix: "€", step: "1" },
  { key: "freeCancelMinutes", label: "Kostenlos stornieren bis … vor Abholung", suffix: "Min", step: "5" },
];

export function AdminPricing() {
  const router = useRouter();
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/pricing")
      .then((r) => {
        if (r.status === 401) {
          router.replace("/admin/login");
          return null;
        }
        return r.json();
      })
      .then((d) => d && setForm(d.pricing))
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  function set(k: string, v: string) {
    setForm((f: any) => ({ ...f, [k]: v }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    const payload = {
      basePrice: Number(form.basePrice),
      perKmDay: Number(form.perKmDay),
      perKmNight: Number(form.perKmNight),
      perKmWeekend: Number(form.perKmWeekend),
      perMinute: Number(form.perMinute ?? 0),
      nightStartHour: Number(form.nightStartHour ?? 22),
      nightEndHour: Number(form.nightEndHour ?? 6),
      fixedBufferPct: Number(form.fixedBufferPct ?? 0),
      perStopFee: Number(form.perStopFee ?? 0),
      noShowFee: Number(form.noShowFee ?? 0),
      cancelFee: Number(form.cancelFee ?? 0),
      freeCancelMinutes: Number(form.freeCancelMinutes ?? 0),
    };
    const res = await fetch("/api/admin/pricing", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  if (!form) return <main className="grid min-h-screen place-items-center bg-ink-100">Lädt …</main>;

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Brand href="/admin" subtitle="Preiseinstellungen" />
          <Link href="/admin" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Dashboard</Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-5 py-6">
        <div className="card p-6" data-testid="pricing-card">
          <h1 className="font-display text-2xl font-extrabold text-ink-900">Tarife</h1>
          <p className="mt-1 text-sm text-ink-500">
            Diese Preise gelten automatisch je nach Wochentag und Uhrzeit für alle Buchungen Ihrer Firma.
          </p>
          <div className="mt-5 grid gap-4">
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <div className="flex items-center gap-3">
                  <input
                    className="field"
                    data-testid={`pricing-${f.key}`}
                    type="number"
                    step={f.step}
                    min="0"
                    value={form[f.key] ?? 0}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                  <span className="w-20 shrink-0 text-sm font-semibold text-ink-500">{f.suffix}</span>
                </div>
              </div>
            ))}
          </div>
          <button onClick={save} disabled={saving} data-testid="pricing-save" className="btn-primary mt-6 w-full">
            {saving ? "Speichern …" : saved ? "✓ Gespeichert" : "Speichern"}
          </button>
        </div>

        <VehicleClassPricingCard />
        <FixedPriceCard />
      </div>
    </main>
  );
}

// Festpreis-Manager: feste Strecken-/Zonenpreise (z. B. Zentrum → Flughafen = 45 €).
function FixedPriceCard() {
  const [rules, setRules] = useState<any[]>([]);
  const empty = { name: "", price: "", fromRadius: "1500", toRadius: "1500", bidirectional: true, vehicleClass: "ALL" };
  const [form, setForm] = useState<any>(empty);
  const [from, setFrom] = useState<{ address: string; lat?: number; lng?: number }>({ address: "" });
  const [to, setTo] = useState<{ address: string; lat?: number; lng?: number }>({ address: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const load = useCallback(() => fetch("/api/admin/fixed-prices").then((r) => (r.ok ? r.json() : { rules: [] })).then((d) => setRules(d.rules ?? [])).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const ok = from.lat != null && to.lat != null && Number(form.price) > 0 && !busy;

  async function create() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/admin/fixed-prices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim() || `${from.address} → ${to.address}`,
        fromLabel: from.address, fromLat: from.lat, fromLng: from.lng, fromRadius: Number(form.fromRadius) || 1500,
        toLabel: to.address, toLat: to.lat, toLng: to.lng, toRadius: Number(form.toRadius) || 1500,
        price: Number(form.price),
        bidirectional: !!form.bidirectional,
        vehicleClass: form.vehicleClass === "ALL" ? null : form.vehicleClass,
      }),
    });
    const d = await res.json(); setBusy(false);
    if (!res.ok) return setMsg(d.error ?? "Fehlgeschlagen.");
    setForm(empty); setFrom({ address: "" }); setTo({ address: "" }); load();
  }
  async function toggle(r: any) {
    await fetch(`/api/admin/fixed-prices/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !r.active }) }).catch(() => {});
    load();
  }
  async function remove(r: any) {
    if (!window.confirm(`Festpreis „${r.name}" wirklich löschen?`)) return;
    await fetch(`/api/admin/fixed-prices/${r.id}`, { method: "DELETE" }).catch(() => {});
    load();
  }

  return (
    <div className="card mt-4 p-6" data-testid="fixed-price-card">
      <h2 className="font-display text-2xl font-extrabold text-ink-900">Festpreise</h2>
      <p className="mt-1 text-sm text-ink-500">
        Hinterlegen Sie feste Preise für bestimmte Strecken (z. B. <strong>Zentrum → Flughafen = 45 €</strong>).
        Liegt eine Direktfahrt in beiden Zonen, gilt Ihr Festpreis statt des Meter-Tarifs – schon in der
        Live-Preisspanne des Kunden und als garantierter Endpreis, sobald Ihr Fahrer annimmt.
      </p>

      <div className="mt-5 grid gap-3">
        <input className="field" data-testid="fp-name" placeholder="Bezeichnung (optional, z. B. Zentrum → Flughafen)" value={form.name} onChange={(e) => setF("name", e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2 rounded-2xl border border-ink-100 p-3">
            <AddressInput label="Start-Zone" placeholder="Adresse Startbereich" value={from.address} onChange={(t) => setFrom({ address: t })} onSelect={(r: GeocodeResult) => setFrom({ address: r.label, lat: r.lat, lng: r.lng })} />
            <label className="grid gap-1 text-xs text-ink-500">Radius (m)<input className="field" type="number" data-testid="fp-from-radius" value={form.fromRadius} onChange={(e) => setF("fromRadius", e.target.value)} /></label>
          </div>
          <div className="grid gap-2 rounded-2xl border border-ink-100 p-3">
            <AddressInput label="Ziel-Zone" placeholder="Adresse Zielbereich" value={to.address} onChange={(t) => setTo({ address: t })} onSelect={(r: GeocodeResult) => setTo({ address: r.label, lat: r.lat, lng: r.lng })} />
            <label className="grid gap-1 text-xs text-ink-500">Radius (m)<input className="field" type="number" data-testid="fp-to-radius" value={form.toRadius} onChange={(e) => setF("toRadius", e.target.value)} /></label>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="grid gap-1 text-xs text-ink-500">Festpreis (€)<input className="field" type="number" step="0.50" data-testid="fp-price" placeholder="45" value={form.price} onChange={(e) => setF("price", e.target.value)} /></label>
          <label className="grid gap-1 text-xs text-ink-500">Fahrzeugklasse<select className="field" data-testid="fp-class" value={form.vehicleClass} onChange={(e) => setF("vehicleClass", e.target.value)}>{FIXED_CLASSES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label className="flex items-end gap-2 pb-3 text-sm font-bold text-ink-600"><input type="checkbox" data-testid="fp-bidir" checked={form.bidirectional} onChange={(e) => setF("bidirectional", e.target.checked)} />Gegenrichtung</label>
        </div>
        {msg && <p className="text-sm font-semibold text-red-600" data-testid="fp-msg">{msg}</p>}
        <button onClick={create} disabled={!ok} data-testid="fp-save" className="btn-primary disabled:opacity-60">{busy ? "…" : "Festpreis anlegen"}</button>
      </div>

      <div className="mt-4 grid gap-2">
        {rules.map((r) => (
          <div key={r.id} className={`rounded-xl border px-3 py-2 text-sm ${r.active ? "border-ink-100 bg-ink-50" : "border-ink-200 bg-white opacity-60"}`} data-testid={`fp-${r.id}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="font-bold text-ink-900">{r.name}</span>
                {!r.active && <span className="ml-2 rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-bold text-ink-600">Pausiert</span>}
                <span className="block text-xs text-ink-500">{r.bidirectional ? "↔" : "→"} {r.vehicleClass ?? "alle Klassen"} · Radius {r.fromRadius}/{r.toRadius} m</span>
              </span>
              <span className="shrink-0 font-display text-lg font-extrabold text-ink-900">{Number(r.price).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</span>
            </div>
            <div className="mt-1 flex justify-end gap-1">
              <button onClick={() => toggle(r)} data-testid={`fp-${r.id}-toggle`} className="rounded-lg px-2 py-1 text-xs font-bold text-ink-600 hover:bg-ink-100">{r.active ? "Pausieren" : "Aktivieren"}</button>
              <button onClick={() => remove(r)} data-testid={`fp-${r.id}-delete`} className="rounded-lg px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-50">Löschen</button>
            </div>
          </div>
        ))}
        {rules.length === 0 && <p className="text-sm text-ink-400">Noch keine Festpreise.</p>}
      </div>
    </div>
  );
}

// Phase 12 Marktplatz: Preis je Fahrzeugklasse (Faktor auf den Grundtarif +
// optionaler Fixaufschlag) und ob die Firma die Klasse anbietet.
function VehicleClassPricingCard() {
  const [classes, setClasses] = useState<any[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/admin/vehicle-classes")
      .then((r) => (r.ok ? r.json() : { classes: [] }))
      .then((d) => setClasses(d.classes ?? []))
      .catch(() => setClasses([]));
  }, []);

  function set(key: string, patch: any) {
    setClasses((cs) => (cs ?? []).map((c) => (c.key === key ? { ...c, ...patch } : c)));
    setSaved(false);
  }

  async function save() {
    if (!classes) return;
    setSaving(true);
    const payload = {
      classes: classes.map((c) => ({
        key: c.key,
        enabled: !!c.enabled,
        multiplier: Number(c.multiplier) || 1,
        flatSurcharge: Number(c.flatSurcharge) || 0,
      })),
    };
    const res = await fetch("/api/admin/vehicle-classes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  }

  if (!classes) return null;

  return (
    <div className="card mt-4 p-6" data-testid="class-pricing-card">
      <h2 className="font-display text-2xl font-extrabold text-ink-900">Fahrzeugklassen</h2>
      <p className="mt-1 text-sm text-ink-500">
        Legen Sie fest, welche Fahrzeugtypen Ihre Firma anbietet und wie sich der Preis je Klasse
        gegenüber dem Grundtarif verändert (Faktor × Grundtarif + Aufschlag).
      </p>
      <div className="mt-5 grid gap-3">
        {classes.map((c) => (
          <div
            key={c.key}
            data-testid={`class-row-${c.key}`}
            className={`rounded-2xl border-2 p-3 transition ${c.enabled ? "border-ink-200 bg-white" : "border-ink-100 bg-ink-50 opacity-70"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-bold text-ink-900">{c.icon} {c.label}</p>
                <p className="text-xs text-ink-500">{c.seats} Pers. · {c.luggage} Gepäck · Standard ×{c.defaultMultiplier}</p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-ink-600">
                <input
                  type="checkbox"
                  data-testid={`class-${c.key}-enabled`}
                  checked={!!c.enabled}
                  onChange={(e) => set(c.key, { enabled: e.target.checked })}
                />
                aktiv
              </label>
            </div>
            {c.enabled && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Faktor</label>
                  <input
                    className="field"
                    data-testid={`class-${c.key}-multiplier`}
                    type="number"
                    step="0.05"
                    min="0.1"
                    value={c.multiplier}
                    onChange={(e) => set(c.key, { multiplier: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Aufschlag (€)</label>
                  <input
                    className="field"
                    data-testid={`class-${c.key}-surcharge`}
                    type="number"
                    step="0.50"
                    min="0"
                    value={c.flatSurcharge}
                    onChange={(e) => set(c.key, { flatSurcharge: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <button onClick={save} disabled={saving} data-testid="class-pricing-save" className="btn-primary mt-6 w-full">
        {saving ? "Speichern …" : saved ? "✓ Gespeichert" : "Klassen speichern"}
      </button>
    </div>
  );
}
