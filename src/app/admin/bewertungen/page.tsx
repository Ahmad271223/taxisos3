"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { formatEuro, formatDateTime } from "@/lib/format";

interface Rating {
  id: string;
  rating: number;
  ratedAt: string | null;
  ratingComment?: string | null;
  customerName: string;
  pickupAddress: string;
  destAddress: string;
  fare: number | null;
  driver: { id: string; name: string; vehiclePlate: string | null } | null;
  company?: { id: string; name: string; slug: string };
}

export default function AdminRatingsPage() {
  const router = useRouter();
  const [ratings, setRatings] = useState<Rating[] | null>(null);
  const [byDriver, setByDriver] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/admin/ratings")
      .then((r) => {
        if (r.status === 401) {
          router.replace("/admin/login");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) {
          setRatings(d.ratings ?? []);
          setByDriver(d.byDriver ?? []);
        }
      })
      .catch(() => {});
  }, [router]);

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <Brand href="/admin" subtitle="Bewertungen" />
          <Link href="/admin" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Dashboard</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-4xl gap-5 px-5 py-6">
        {/* Aggregat pro Fahrer */}
        {byDriver.length > 0 && (
          <section className="card p-5" data-testid="ratings-by-driver">
            <h2 className="font-display text-lg font-extrabold">Ø Bewertung je Fahrer</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {byDriver.map((g: any) => (
                <div key={g.driverId} className="flex items-center justify-between rounded-xl bg-ink-50 p-3 text-sm">
                  <span className="font-bold text-ink-900">Fahrer-ID {g.driverId.slice(0, 8)}</span>
                  <span className="font-extrabold text-brand-700">
                    ★ {Number(g._avg?.rating ?? 0).toFixed(1)} <span className="text-ink-500">({g._count?.rating ?? 0})</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="card p-0" data-testid="ratings-list">
          <h2 className="border-b border-ink-100 px-5 py-3 font-display font-bold">Alle Bewertungen</h2>
          {ratings === null ? (
            <p className="px-5 py-6 text-sm text-ink-400">Lädt …</p>
          ) : ratings.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-400">Noch keine Bewertungen.</p>
          ) : (
            ratings.map((r) => (
              <div key={r.id} className="border-b border-ink-50 px-5 py-4 last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-lg font-extrabold text-brand-700">
                      {"★".repeat(r.rating)}<span className="text-ink-200">{"★".repeat(5 - r.rating)}</span>
                    </p>
                    <p className="mt-1 text-sm font-bold text-ink-900">
                      {r.driver?.name ?? "Fahrer entfernt"}
                      {r.driver?.vehiclePlate && (
                        <span className="ml-2 rounded bg-brand-500 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink-900">
                          {r.driver.vehiclePlate}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-ink-500">
                      {r.customerName} · {r.pickupAddress} → {r.destAddress}
                    </p>
                    {r.ratingComment && (
                      <p className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-sm italic text-ink-700">
                        „{r.ratingComment}"
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-ink-400">
                    {r.ratedAt && <p>{formatDateTime(r.ratedAt)}</p>}
                    {r.fare != null && <p className="mt-1 font-bold text-ink-700">{formatEuro(r.fare)}</p>}
                    {r.company && <p className="mt-1">{r.company.name}</p>}
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
