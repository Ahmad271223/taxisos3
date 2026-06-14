"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";

const FIELDS: { key: string; label: string; suffix: string; step?: string }[] = [
  { key: "perKmDay", label: "Preis pro km · Tag (06:00–22:00)", suffix: "€ / km", step: "0.10" },
  { key: "perKmNight", label: "Preis pro km · Nacht (22:00–06:00)", suffix: "€ / km", step: "0.10" },
  { key: "perKmWeekend", label: "Preis pro km · Wochenende (Sa/So)", suffix: "€ / km", step: "0.10" },
  { key: "perMinute", label: "Preis pro Minute (optional)", suffix: "€ / min", step: "0.05" },
  { key: "basePrice", label: "Grundpreis", suffix: "€", step: "0.10" },
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
      </div>
    </main>
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
