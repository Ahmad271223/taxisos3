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

        {/* Sammel-Abrechnung (Phase 5) */}
        <SuperInvoiceRun />

        {/* Rechnungs-Archiv + Zahlungsabgleich (Phase 6) */}
        <SuperInvoiceArchive />

        <Link href="/admin/bewertungen" className="btn-primary w-fit">Alle Bewertungen ansehen</Link>
      </div>
    </main>
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
