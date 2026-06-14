"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const LocationPicker = dynamic(() => import("@/components/LocationPicker"), { ssr: false });

const HANNOVER: [number, number] = [52.3759, 9.732];

export interface PickedPlace {
  address: string;
  lat: number;
  lng: number;
}

// Modal mit Karten-Pin-Auswahl + Adress-Rückauflösung. Bestätigen ruft onConfirm.
export function MapPickerModal({
  open,
  title = "Ort auf der Karte wählen",
  initial,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  initial?: PickedPlace | null;
  onClose: () => void;
  onConfirm: (place: PickedPlace) => void;
}) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(
    initial && initial.lat != null ? { lat: initial.lat, lng: initial.lng } : null,
  );
  const [address, setAddress] = useState(initial?.address ?? "");
  const [busy, setBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);

  // Reset, wenn das Modal mit neuem Startwert geöffnet wird.
  useEffect(() => {
    if (open) {
      setPos(initial && initial.lat != null ? { lat: initial.lat, lng: initial.lng } : null);
      setAddress(initial?.address ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Gewählten Punkt zur Adresse auflösen (Reverse-Geocoding).
  useEffect(() => {
    if (!pos) return;
    let cancelled = false;
    setBusy(true);
    fetch(`/api/geocode?reverse=1&lat=${pos.lat}&lng=${pos.lng}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const label = d?.results?.[0]?.label;
        setAddress(label || `Pin: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`);
      })
      .catch(() => {
        if (!cancelled) setAddress(`Pin: ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pos?.lat, pos?.lng]);

  function useMyLocation() {
    if (!navigator.geolocation) return;
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setGpsBusy(false);
      },
      () => setGpsBusy(false),
      { timeout: 6000 },
    );
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/60 p-0 sm:place-items-center sm:p-4" data-testid="map-picker">
      <div className="flex h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white sm:h-[80vh] sm:max-w-xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
          <p className="font-display font-extrabold text-ink-900">{title}</p>
          <button onClick={onClose} data-testid="map-picker-close" className="text-sm font-bold text-ink-500 hover:text-ink-900">Schließen</button>
        </div>

        <div className="relative flex-1">
          <LocationPicker value={pos} center={pos ? [pos.lat, pos.lng] : HANNOVER} onChange={(lat, lng) => setPos({ lat, lng })} />
          {!pos && (
            <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-ink-900/85 px-4 py-1.5 text-xs font-bold text-white">
              Tippen Sie auf die Karte, um den Ort zu setzen
            </div>
          )}
          <button
            type="button"
            onClick={useMyLocation}
            disabled={gpsBusy}
            data-testid="map-picker-gps"
            className="absolute bottom-4 right-4 z-[1000] rounded-full bg-brand-500 px-4 py-2 text-xs font-bold text-ink-900 shadow-card hover:bg-brand-400 disabled:opacity-60"
          >
            {gpsBusy ? "Suche…" : "📍 Mein Standort"}
          </button>
        </div>

        <div className="border-t border-ink-100 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Gewählter Ort</p>
          <p className="mt-1 min-h-[20px] text-sm font-bold text-ink-900" data-testid="map-picker-address">
            {busy ? "Adresse wird ermittelt…" : address || "Noch kein Ort gewählt"}
          </p>
          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              disabled={!pos || busy}
              data-testid="map-picker-confirm"
              onClick={() => pos && onConfirm({ address, lat: pos.lat, lng: pos.lng })}
              className="btn-primary disabled:opacity-60"
            >
              Diesen Ort übernehmen
            </button>
            <button type="button" onClick={onClose} className="btn-ghost">Abbrechen</button>
          </div>
        </div>
      </div>
    </div>
  );
}
