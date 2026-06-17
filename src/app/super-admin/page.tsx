"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { SuperInvoiceRun } from "@/components/SuperInvoiceRun";
import { SuperInvoiceArchive } from "@/components/SuperInvoiceArchive";
import { formatEuro, formatDateTime } from "@/lib/format";

export default function SuperAdminPage() {
  const router = useRouter();
  const [data, setData] = useState<any | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.admin?.role !== "SUPER_ADMIN") {
          router.replace("/admin/login");
          return;
        }
        return fetch("/api/super/overview").then((r) => r.json());
      })
      .then((d) => d && setData(d))
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  if (!data) {
    return (
      <main className="grid min-h-screen place-items-center bg-ink-950 text-white">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          <p className="mt-4 text-sm text-ink-300">Lädt …</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="bg-ink-950 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <Brand href="/super-admin" subtitle="Super-Admin · Alle Mandanten" tone="light" />
          <button
            onClick={async () => {
              await fetch("/api/auth/logout?scope=admin", { method: "POST" });
              router.replace("/admin/login");
            }}
            className="rounded-xl bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/20"
            data-testid="super-logout"
          >
            Abmelden
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-8">
        {/* Plattform-Finanzen */}
        <div className="rounded-3xl bg-ink-900 p-6 text-white" data-testid="platform-financials">
          <p className="eyebrow text-brand-500">Plattform-Provision</p>
          <h2 className="mt-1 font-display text-2xl font-extrabold">Vermittlungs­einnahmen</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <FinStat label="Brutto-Umsatz aller Fahrten" value={formatEuro(data.totals.grossRevenue)} testid="fin-gross" />
            <FinStat label="Plattform-Einnahmen" value={formatEuro(data.totals.platformFee)} accent testid="fin-fee" />
            <FinStat label="Auszahlung an Firmen" value={formatEuro(data.totals.companyNet)} testid="fin-net" />
            <FinStat label="Abgeschlossene Fahrten" value={data.totals.completedTrips} testid="fin-trips" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Unternehmen" value={data.totals.companies} testid="stat-companies" />
          <Stat label="Fahrer gesamt" value={data.totals.drivers} testid="stat-drivers" />
          <Stat label="Fahrten gesamt" value={data.totals.bookings} testid="stat-bookings" />
          <Stat label="Stornos (30 T.)" value={data.totals.cancellations30d} testid="stat-cancellations" />
        </div>

        <div className="card overflow-hidden p-0">
          <h2 className="border-b border-ink-100 px-5 py-3 font-display font-bold">Unternehmen</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3">Firma</th>
                  <th className="px-3 py-3">Tarif</th>
                  <th className="px-3 py-3 text-right">Fahrten</th>
                  <th className="px-3 py-3 text-right">Brutto</th>
                  <th className="px-3 py-3 text-right">Provision</th>
                  <th className="px-3 py-3 text-right">Netto</th>
                  <th className="px-3 py-3 text-right">★</th>
                </tr>
              </thead>
              <tbody>
                {data.companies.map((c: any) => (
                  <tr key={c.id} className="border-t border-ink-50" data-testid={`super-company-${c.slug}`}>
                    <td className="px-5 py-3">
                      <p className="font-bold text-ink-900">{c.name}</p>
                      <p className="text-xs text-ink-500">/c/{c.slug}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          c.cityTier === "BIG"
                            ? "bg-brand-500 text-ink-900"
                            : "bg-ink-100 text-ink-700"
                        }`}
                      >
                        {c.cityTier === "BIG" ? "Großstadt 7%" : "Klein/Land 5%"}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold">{c.completedTrips}</td>
                    <td className="px-3 py-3 text-right">{formatEuro(c.grossRevenue)}</td>
                    <td className="px-3 py-3 text-right font-extrabold text-brand-700">{formatEuro(c.platformFee)}</td>
                    <td className="px-3 py-3 text-right">{formatEuro(c.companyNet)}</td>
                    <td className="px-3 py-3 text-right">{c.avgRating?.toFixed?.(1) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Preis-Leitplanken + Kassentarif (DTA) */}
        <PlatformConfigCard />

        {/* Sammel-Abrechnung (Phase 5) */}
        <SuperInvoiceRun />

        {/* Rechnungs-Archiv + Zahlungsabgleich (Phase 6) */}
        <SuperInvoiceArchive />

        <Link href="/admin/bewertungen" className="btn-primary w-fit">Alle Bewertungen ansehen</Link>
      </div>
    </main>
  );
}

function PlatformConfigCard() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    fetch("/api/super/platform-config").then((r) => (r.ok ? r.json() : null)).then((d) => d && setCfg(d.config)).catch(() => {});
  }, []);
  function set(k: string, v: string) { setCfg((c: any) => ({ ...c, [k]: v })); setSaved(false); }
  async function save() {
    if (!cfg) return;
    setSaving(true);
    const res = await fetch("/api/super/platform-config", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        minBaseFare: Number(cfg.minBaseFare) || 0,
        minPerKm: Number(cfg.minPerKm) || 0,
        insuranceBaseFare: Number(cfg.insuranceBaseFare) || 0,
        insurancePerKm: Number(cfg.insurancePerKm) || 0,
      }),
    });
    setSaving(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
  }
  if (!cfg) return null;
  const F = ({ k, label, suffix }: { k: string; label: string; suffix: string }) => (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input className="field" type="number" step="0.10" min="0" data-testid={`pc-${k}`} value={cfg[k] ?? 0} onChange={(e) => set(k, e.target.value)} />
        <span className="w-20 shrink-0 text-sm font-semibold text-ink-500">{suffix}</span>
      </div>
    </div>
  );
  return (
    <div className="card p-6" data-testid="platform-config-card">
      <h2 className="font-display text-xl font-extrabold text-ink-900">Preis-Leitplanken &amp; Kassentarif</h2>
      <p className="mt-1 text-sm text-ink-500">Schützt vor ruinösem Unterbieten und legt den Krankenkassen-Tarif (DTA) fest. Alle Werte 0 = deaktiviert.</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <p className="eyebrow text-ink-400 sm:col-span-2">Preisuntergrenze (Mindest-Endpreis = Grundbetrag + €/km)</p>
        <F k="minBaseFare" label="Mindest-Grundbetrag" suffix="€" />
        <F k="minPerKm" label="Mindestpreis pro km" suffix="€ / km" />
        <p className="eyebrow mt-2 text-ink-400 sm:col-span-2">Krankenkassen-/DTA-Tarif (für Kassenfahrten)</p>
        <F k="insuranceBaseFare" label="Kassen-Grundbetrag" suffix="€" />
        <F k="insurancePerKm" label="Kassen-Preis pro km" suffix="€ / km" />
      </div>
      <button onClick={save} disabled={saving} data-testid="pc-save" className="btn-primary mt-6">{saving ? "Speichern …" : saved ? "✓ Gespeichert" : "Speichern"}</button>
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: any; testid?: string }) {
  return (
    <div className="card p-4" data-testid={testid}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold">{value}</p>
    </div>
  );
}

function FinStat({ label, value, accent, testid }: { label: string; value: any; accent?: boolean; testid?: string }) {
  return (
    <div
      className={`rounded-2xl p-4 ${accent ? "bg-brand-500 text-ink-900" : "bg-white/5 text-white"}`}
      data-testid={testid}
    >
      <p className={`text-[11px] font-bold uppercase tracking-wide ${accent ? "text-ink-900/70" : "text-white/60"}`}>
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-extrabold">{value}</p>
    </div>
  );
}
