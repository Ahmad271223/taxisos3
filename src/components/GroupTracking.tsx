"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { formatEuro, formatDateTime } from "@/lib/format";
import { TRACKING_LABEL } from "@/lib/status";

const DONE = new Set(["BEENDET", "ABGESCHLOSSEN"]);
const ASSIGNED = new Set(["FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT", "RESERVIERT_FAHRER", "ZUGEWIESEN"]);

export function GroupTracking({ groupId }: { groupId: string }) {
  const [group, setGroup] = useState<any | null | undefined>(undefined);

  const load = useCallback(() => {
    fetch(`/api/groups/${groupId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGroup(d?.group ?? null))
      .catch(() => setGroup(null));
  }, [groupId]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  if (group === undefined) return <main className="grid min-h-screen place-items-center bg-ink-50 text-ink-500">Lädt …</main>;
  if (group === null)
    return (
      <main className="grid min-h-screen place-items-center bg-ink-50">
        <div className="text-center">
          <p className="text-ink-600">Gruppenbuchung nicht gefunden.</p>
          <Link href="/" className="mt-2 inline-block font-bold text-ink-900 underline">Zur Startseite</Link>
        </div>
      </main>
    );

  const bookings: any[] = group.bookings ?? [];
  const assignedCount = bookings.filter((b) => ASSIGNED.has(b.trackingStatus) || DONE.has(b.trackingStatus)).length;
  const total = bookings.reduce((s, b) => s + (b.fare ?? b.priceExact ?? b.priceApprox ?? 0), 0);

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Brand href="/" subtitle="Gruppenfahrt" />
          <Link href="/" className="text-sm font-bold text-ink-500 hover:text-ink-900">← Startseite</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-2xl gap-4 px-5 py-6">
        <div className="card p-5" data-testid="group-header">
          {group.eventLabel && <p className="eyebrow text-ink-500">{group.eventLabel}</p>}
          <h1 className="font-display text-2xl font-extrabold text-ink-900">{group.vehicleCount} Fahrzeuge</h1>
          <p className="mt-1 text-sm text-ink-600">{group.pickupAddress} → {group.destAddress}</p>
          <p className="mt-1 text-xs text-ink-500">
            {group.totalPassengers} Personen{group.totalLuggage ? ` · ${group.totalLuggage} Gepäck` : ""}
            {group.isScheduled && group.scheduledAt ? ` · Termin: ${formatDateTime(group.scheduledAt)}` : ""}
          </p>
          <div className={`mt-3 rounded-xl px-3 py-2 ${assignedCount >= group.vehicleCount ? "bg-green-50" : "bg-ink-50"}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-ink-900" data-testid="group-progress">
                {assignedCount >= group.vehicleCount
                  ? `✓ Alle ${group.vehicleCount} Fahrzeuge bestätigt`
                  : `${assignedCount}/${group.vehicleCount} Fahrer zugesagt – Suche läuft …`}
              </span>
              <span className="text-sm font-extrabold text-ink-900">ca. {formatEuro(total)}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
              <div
                className={`h-full rounded-full ${assignedCount >= group.vehicleCount ? "bg-green-500" : "bg-brand-500"}`}
                style={{ width: `${Math.min(100, (assignedCount / Math.max(1, group.vehicleCount)) * 100)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-2" data-testid="group-vehicles">
          {bookings.map((b, i) => {
            const assigned = ASSIGNED.has(b.trackingStatus) || DONE.has(b.trackingStatus);
            return (
              <Link
                key={b.id}
                href={`/verfolgen/${b.trackingRef ?? b.id}`}
                data-testid={`group-vehicle-${i}`}
                className="card flex items-center justify-between gap-3 p-4 transition hover:ring-2 hover:ring-brand-500"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{b.vehicleClassIcon ?? "🚕"}</span>
                  <div>
                    <p className="font-bold text-ink-900">Fahrzeug {i + 1} · {b.vehicleClassLabel ?? "Taxi"}</p>
                    <p className="text-xs text-ink-500">
                      {b.driver ? `${b.driver.name}${b.driver.vehiclePlate ? " · " + b.driver.vehiclePlate : ""}` : "Suche Fahrer …"}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${assigned ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                  {TRACKING_LABEL[b.trackingStatus] ?? b.trackingStatus}
                </span>
              </Link>
            );
          })}
        </div>

        <p className="text-center text-xs text-ink-400">Diese Seite aktualisiert sich automatisch.</p>
      </div>
    </main>
  );
}
