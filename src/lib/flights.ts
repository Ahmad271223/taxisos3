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
  status: string; // SCHEDULED | DELAYED | ACTIVE | LANDED | CANCELLED | UNKNOWN
  delayMinutes: number;
  terminal: string | null;
  gate: string | null;
  // Betroffener Flughafen (bei ANKUNFT der Zielflughafen, bei ABFLUG der Startflughafen).
  airportName: string | null;
  airportIata: string | null;
  // Geplante (und ggf. erwartete/tatsächliche) Zeit am betroffenen Flughafen.
  scheduledAt: string | null;
  estimatedAt: string | null;
  actualAt: string | null; // tatsächliche Lande-/Startzeit (wenn vorhanden)
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
  // Plausible geplante Zeit: heute, in ~3 Stunden, runde Stunde.
  const sched = new Date();
  sched.setHours(sched.getHours() + 3, 0, 0, 0);
  return {
    flightNumber: fn,
    direction,
    status: delayed ? "DELAYED" : "SCHEDULED",
    delayMinutes: delayed ? 75 : 0,
    terminal: terminals[hash(fn) % terminals.length],
    gate: null,
    airportName: "Demo-Flughafen",
    airportIata: "DEMO",
    scheduledAt: sched.toISOString(),
    estimatedAt: null,
    actualAt: null,
    airline: fn.slice(0, 2) || null,
    source: "mock",
  };
}

// Eine AviationStack-Abfrage für einen Parameter (flight_iata bzw. flight_icao).
// Liefert die Trefferzeilen, [] (kein Treffer) oder null (harter Fehler/Key/Limit).
async function fetchFlightRows(key: string, param: "flight_iata" | "flight_icao", value: string): Promise<any[] | null> {
  const url = `http://api.aviationstack.com/v1/flights?access_key=${key}&${param}=${encodeURIComponent(value)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[flights] AviationStack HTTP ${res.status} (${param}=${value}) – Fallback auf Demo-Daten.`);
    return null;
  }
  const data = (await res.json()) as { data?: any[]; error?: { code?: string; message?: string } };
  // AviationStack liefert Fehler oft mit HTTP 200 im Body (z. B. ungültiger Key,
  // Monatslimit erreicht, Feature gesperrt). Das ist die häufigste Render-Ursache.
  if (data.error) {
    console.warn(`[flights] AviationStack-Fehler: ${data.error.code ?? "?"} – ${data.error.message ?? ""} (Fallback auf Demo-Daten).`);
    return null;
  }
  return data.data ?? [];
}

// AviationStack-Abfrage (best effort). Bei Fehler -> Mock (damit der Flow nie bricht).
async function liveFlight(flightNumber: string, direction: FlightDirection, dateISO?: string): Promise<FlightInfo | null> {
  const key = (process.env.AVIATIONSTACK_KEY ?? "").trim();
  if (!key) return null;
  const fn = normalizeFlightNumber(flightNumber);
  try {
    // Erst als IATA-Nummer (z. B. LH400, XQ511) abfragen. Kein Treffer ->
    // als ICAO-Nummer nachfragen (z. B. DLH400, SXS511, wie auf dem Flugbrett).
    let rows = await fetchFlightRows(key, "flight_iata", fn);
    if (rows !== null && rows.length === 0) {
      rows = await fetchFlightRows(key, "flight_icao", fn);
    }
    if (rows === null) return null; // harter Fehler (Key/Limit) -> Demo
    // Optional auf Datum filtern, sonst ersten aktiven Treffer nehmen.
    const row = (dateISO ? rows.find((r) => r.flight_date === dateISO.slice(0, 10)) : rows[0]) ?? rows[0];
    if (!row) {
      console.warn(`[flights] Kein Treffer für ${fn} (Datum ${dateISO?.slice(0, 10) ?? "egal"}) – Fallback auf Demo-Daten.`);
      return null;
    }
    const leg = direction === "ARRIVAL" ? row.arrival : row.departure;
    let delayMinutes = Number(leg?.delay ?? 0) || 0;
    // Verspätung aus erwarteter vs. geplanter Zeit ableiten, falls das delay-Feld
    // leer ist (beide Zeiten haben denselben Offset -> die Differenz ist korrekt).
    if (!delayMinutes && leg?.scheduled && leg?.estimated) {
      const diff = Math.round((Date.parse(leg.estimated) - Date.parse(leg.scheduled)) / 60_000);
      if (diff > 0) delayMinutes = diff;
    }
    const raw = (row.flight_status ?? "").toUpperCase();
    const passthrough = raw === "ACTIVE" || raw === "LANDED" || raw === "CANCELLED";
    let status = passthrough ? raw : delayMinutes > 0 ? "DELAYED" : "SCHEDULED";
    // Die tatsächliche Zeit des relevanten Legs ist die Wahrheit (flight_status
    // hängt bei AviationStack oft nach): liegt sie vor, ist der Flug bei ANKUNFT
    // gelandet bzw. bei ABFLUG bereits gestartet.
    const legActual = leg?.actual ?? null;
    if (legActual) status = direction === "ARRIVAL" ? "LANDED" : "ACTIVE";
    return {
      flightNumber: fn,
      direction,
      status,
      delayMinutes,
      terminal: leg?.terminal ?? null,
      gate: leg?.gate ?? null,
      airportName: leg?.airport ?? null,
      airportIata: leg?.iata ?? null,
      scheduledAt: leg?.scheduled ?? null,
      estimatedAt: leg?.estimated ?? null,
      actualAt: legActual,
      airline: row.airline?.name ?? fn.slice(0, 2) ?? null,
      source: "live",
    };
  } catch (e) {
    console.warn(`[flights] AviationStack-Ausnahme: ${(e as Error).message} – Fallback auf Demo-Daten.`);
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
