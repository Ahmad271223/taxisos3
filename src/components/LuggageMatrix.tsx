"use client";

import { useEffect, useRef, useState } from "react";
import { LUGGAGE_ITEMS, recommendFromLuggage } from "@/lib/luggage";
import { vehicleClass } from "@/lib/vehicleClasses";

// Gepäck-Matrix: Auswahl der Gepäckarten -> Live-Empfehlung der Fahrzeugklasse,
// inkl. ausgeschlossener (zu kleiner) Klassen. Meldet die Empfehlung an die
// Form (onRecommend), die dann die vehicleClass setzt.
export function LuggageMatrix({ passengers, onRecommend }: { passengers: number; onRecommend?: (classKey: string) => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const total = Object.values(counts).reduce((s, n) => s + (n || 0), 0);
  const rec = recommendFromLuggage(passengers, counts);
  const lastApplied = useRef<string>("");

  useEffect(() => {
    if (total > 0 && onRecommend && rec.recommended !== lastApplied.current) {
      lastApplied.current = rec.recommended;
      onRecommend(rec.recommended);
    }
  }, [rec.recommended, total, onRecommend]);

  const set = (k: string, delta: number) => setCounts((c) => ({ ...c, [k]: Math.max(0, (c[k] ?? 0) + delta) }));

  return (
    <div className="grid gap-3" data-testid="luggage-matrix">
      <div className="grid gap-2 sm:grid-cols-2">
        {LUGGAGE_ITEMS.map((it) => (
          <div key={it.key} className="flex items-center justify-between rounded-xl bg-ink-50 px-3 py-2">
            <span className="text-sm font-semibold text-ink-800">{it.icon} {it.label}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => set(it.key, -1)} data-testid={`lug-${it.key}-minus`} className="grid h-7 w-7 place-items-center rounded-lg bg-white font-bold text-ink-700 ring-1 ring-ink-200 hover:bg-ink-100">−</button>
              <span className="w-5 text-center font-bold text-ink-900" data-testid={`lug-${it.key}-count`}>{counts[it.key] ?? 0}</span>
              <button type="button" onClick={() => set(it.key, +1)} data-testid={`lug-${it.key}-plus`} className="grid h-7 w-7 place-items-center rounded-lg bg-white font-bold text-ink-700 ring-1 ring-ink-200 hover:bg-ink-100">+</button>
            </div>
          </div>
        ))}
      </div>

      {total > 0 && (
        <div className="rounded-2xl border-2 border-brand-200 bg-brand-50 p-3" data-testid="luggage-recommendation">
          <p className="text-sm font-bold text-ink-900">
            Empfehlung: {vehicleClass(rec.recommended).icon} {vehicleClass(rec.recommended).label}
          </p>
          <p className="text-xs text-ink-600">{rec.note}</p>
          {rec.excluded.length > 0 && (
            <p className="mt-1 text-[11px] text-ink-500">
              Ausgeschlossen: {rec.excluded.map((e) => `${vehicleClass(e.key).short} (${e.reason})`).join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
