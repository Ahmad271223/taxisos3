// Flughafen-Modul (Phase 14): Flugdaten-Abfrage (Status, Verspätung, Terminal).
//
// Anbieter-pluggbar wie der Geocoder: mit AVIATIONSTACK_KEY echte Live-Daten,
// sonst ein deterministischer Mock, damit der Flow lokal/in Tests funktioniert.
// Der Mock simuliert eine Verspätung, wenn die Flugnummer "DELAY" oder "9999"
// enthält – so lässt sich die Verspätungs-Logik reproduzierbar testen.

export type FlightDirection = "ARRIVAL" | "DEPARTURE";

// Zeit nach Landung für Aussteigen + Gepäck + Treffpunkt (Abholung bei Ankunft).
export const BAGGAGE_BUFFER_MIN = 30;

export interface FlightInfo {
  flightNumber: string;
  direction: FlightDirection;
  status: string; // SCHEDULED | DELAYED | LANDED | CANCELLED | UNKNOWN
  delayMinutes: number;
  terminal: string | null;
  airline: string | null;
  source: "live" | "mock";
}

export function flightProviderConfigured(): boolean {
  return !!process.env.AVIATIONSTACK_KEY;
}

export function normalizeFlightNumber(s: string): string {
  return (s || "").toUpperCase().replace(/\s+/g, "");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Berechnet die Abhol-/Pickup-Zeit bei ANKUNFT: geplante Landung + Verspätung
// + Puffer (Gepäck). Bei ABFLUG wird die Abholzeit separat vom Kunden gesetzt.
export function airportPickupTime(flightScheduledAt: Date, direction: FlightDirection, delayMinutes: number): Date {
  const t = new Date(flightScheduledAt);
  if (direction === "ARRIVAL") {
    t.setMinutes(t.getMinutes() + (delayMinutes || 0) + BAGGAGE_BUFFER_MIN);
  }
  return t;
}

function mockFlight(flightNumber: string, direction: FlightDirection): FlightInfo {
  const fn = normalizeFlightNumber(flightNumber);
  const delayed = /DELAY|9999/.test(fn);
  const terminals = ["1", "2", "A", "B"];
  return {
    flightNumber: fn,
    direction,
    status: delayed ? "DELAYED" : "SCHEDULED",
    delayMinutes: delayed ? 75 : 0,
    terminal: terminals[hash(fn) % terminals.length],
    airline: fn.slice(0, 2) || null,
    source: "mock",
  };
}

// AviationStack-Abfrage (best effort). Bei Fehler -> Mock (damit der Flow nie bricht).
async function liveFlight(flightNumber: string, direction: FlightDirection, dateISO?: string): Promise<FlightInfo | null> {
  const key = process.env.AVIATIONSTACK_KEY;
  if (!key) return null;
  const fn = normalizeFlightNumber(flightNumber);
  try {
    const url = `http://api.aviationstack.com/v1/flights?access_key=${key}&flight_iata=${encodeURIComponent(fn)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: any[] };
    const rows = data.data ?? [];
    // Optional auf Datum filtern, sonst ersten aktiven Treffer nehmen.
    const row = (dateISO ? rows.find((r) => r.flight_date === dateISO.slice(0, 10)) : rows[0]) ?? rows[0];
    if (!row) return null;
    const leg = direction === "ARRIVAL" ? row.arrival : row.departure;
    const delayMinutes = Number(leg?.delay ?? 0) || 0;
    const status = (row.flight_status ?? "").toUpperCase();
    return {
      flightNumber: fn,
      direction,
      status: status === "ACTIVE" || status === "LANDED" ? status : delayMinutes > 0 ? "DELAYED" : "SCHEDULED",
      delayMinutes,
      terminal: leg?.terminal ?? null,
      airline: row.airline?.name ?? fn.slice(0, 2) ?? null,
      source: "live",
    };
  } catch {
    return null;
  }
}

export async function lookupFlight(
  flightNumber: string,
  direction: FlightDirection,
  dateISO?: string,
): Promise<FlightInfo> {
  const live = await liveFlight(flightNumber, direction, dateISO);
  return live ?? mockFlight(flightNumber, direction);
}
