"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import type { MapMarker } from "@/components/Map";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

const HANNOVER: [number, number] = [52.3759, 9.732];

export function LiveTaxiMap() {
  const [taxis, setTaxis] = useState<any[]>([]);
  const [available, setAvailable] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/taxis/live")
        .then((r) => r.json())
        .then((d) => {
          if (stop) return;
          setTaxis(d.taxis ?? []);
          setAvailable(d.available ?? 0);
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    load();
    const iv = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, []);

  // Auswahl mit frischen Live-Daten zusammenführen (Position aktualisiert sich).
  const selectedLive = selected ? taxis.find((t) => t.id === selected.id) ?? selected : null;

  const markers: MapMarker[] = useMemo(
    () =>
      taxis.map((t) => ({
        id: t.id,
        lat: t.lat,
        lng: t.lng,
        kind: "car" as const,
        color: t.status === "FREI" ? "#10B981" : "#9CA3AF",
        onClick: () => setSelected(t),
      })),
    [taxis],
  );

  const center: [number, number] = taxis[0] ? [taxis[0].lat, taxis[0].lng] : HANNOVER;

  return (
    <main className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Brand href="/" subtitle="Live-Karte" />
          <Link href="/buchen" className="text-sm font-bold text-ink-500 hover:text-ink-900">Bestellen →</Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-5">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-display text-2xl font-extrabold text-ink-900">Taxis in der Nähe</h1>
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-green-800" data-testid="available-count">
            {available} frei
          </span>
        </div>

        <div className="overflow-hidden rounded-3xl ring-1 ring-ink-200 shadow-card" data-testid="live-map">
          <div className="h-[55vh] min-h-[360px]">
            <Map center={center} markers={markers} fit />
          </div>
        </div>

        {loaded && taxis.length === 0 && (
          <p className="mt-4 text-center text-sm text-ink-500" data-testid="no-taxis">Gerade sind keine Taxis online. Bitte später erneut schauen.</p>
        )}

        {/* Detailkarte des gewählten Taxis */}
        {selectedLive && (
          <div className="mt-4 card p-5" data-testid="taxi-detail">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-100 text-3xl">{selectedLive.vehicleClassIcon}</span>
                <div>
                  <p className="font-display text-xl font-extrabold text-ink-900" data-testid="taxi-detail-class">{selectedLive.vehicleClassLabel}</p>
                  <p className="text-sm text-ink-500">{selectedLive.company ?? "Taxi"}</p>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${selectedLive.status === "FREI" ? "bg-green-100 text-green-800" : "bg-ink-200 text-ink-600"}`}>
                {selectedLive.status === "FREI" ? "frei" : "besetzt"}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Info label="Fahrer" value={selectedLive.name} />
              <Info label="Fahrzeug" value={[selectedLive.vehicleColor, selectedLive.vehicleModel].filter(Boolean).join(" ") || "—"} />
              <Info label="Kennzeichen" value={selectedLive.vehiclePlate ?? "—"} />
              <Info label="Sitzplätze" value={`${selectedLive.vehicleSeats} Personen`} />
              <Info label="Gepäck" value={`${selectedLive.luggage} Stück`} />
            </div>

            <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
              <Link
                href={`/buchen?class=${selectedLive.vehicleClass}${selectedLive.status === "FREI" ? `&driver=${selectedLive.id}` : ""}`}
                data-testid="taxi-book"
                className="btn-primary text-center"
              >
                {selectedLive.status === "FREI" ? "Genau dieses Taxi bestellen" : `Jetzt ${selectedLive.vehicleClassLabel} bestellen`}
              </Link>
              <button onClick={() => setSelected(null)} className="btn-ghost">Schließen</button>
            </div>
            <p className="mt-2 text-center text-[11px] text-ink-400">
              {selectedLive.status === "FREI"
                ? "Dieses Fahrzeug wird zuerst angefragt. Sagt es nicht zu, suchen wir das nächste freie."
                : "Aktuell besetzt – wir suchen das nächste freie Fahrzeug dieser Kategorie."}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="font-bold text-ink-900">{value}</p>
    </div>
  );
}
