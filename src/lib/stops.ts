// Mehrziel-Vorabplanung (Phase 2e): Hilfsfunktionen fuer Zwischenstopps.
// Stopps werden auf der Buchung als JSON-String persistiert (SQLite kennt kein
// natives Array) und ueberall als typisiertes `Stop[]` verarbeitet.

import type { GeoPoint } from "@/lib/geo";

export interface Stop {
  address: string;
  lat: number;
  lng: number;
}

// Roh-Eingabe (z. B. aus dem Request-Body) defensiv in saubere Stopps wandeln.
export function normalizeStops(input: unknown): Stop[] {
  if (!Array.isArray(input)) return [];
  const out: Stop[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const address = typeof r.address === "string" ? r.address : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    out.push({ address, lat, lng });
  }
  return out;
}

// JSON-String aus der DB -> Stop[]. Fehlertolerant (nie werfen).
export function parseStops(json: string | null | undefined): Stop[] {
  if (!json) return [];
  try {
    return normalizeStops(JSON.parse(json));
  } catch {
    return [];
  }
}

// Stop[] -> JSON-String fuer die DB. Leere Liste -> null (Direktfahrt).
export function serializeStops(stops: Stop[] | null | undefined): string | null {
  if (!stops || stops.length === 0) return null;
  return JSON.stringify(stops);
}

// Vollstaendige, geordnete Wegpunkt-Liste einer Fahrt:
// Abholung -> Zwischenstopps -> Endziel. Basis fuer Routing & Preis.
export function bookingRoutePoints(b: {
  pickupLat: number;
  pickupLng: number;
  destLat: number;
  destLng: number;
  stops?: string | null;
}): GeoPoint[] {
  const stops = parseStops(b.stops);
  return [
    { lat: b.pickupLat, lng: b.pickupLng },
    ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    { lat: b.destLat, lng: b.destLng },
  ];
}
