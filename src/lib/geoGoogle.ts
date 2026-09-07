// Google Maps Platform als Anbieter fuer Adresssuche, Rueckwaerts-Suche und
// Routen. Wird von lib/geo.ts benutzt, sobald GOOGLE_MAPS_API_KEY gesetzt ist.
//
// Verwendete Dienste (im Google-Cloud-Projekt zu aktivieren):
//   - Geocoding API  -> Adresse <-> Koordinate
//   - Routes API     -> Strecke, Fahrzeit (verkehrsabhaengig), Streckenverlauf
//
// Dieser Schluessel ist ein SERVER-Schluessel und verlaesst den Server nie.
// Er sollte in der Cloud Console auf genau diese beiden APIs eingeschraenkt
// sein. Die sichtbare Karte im Browser nutzt einen ZWEITEN Schluessel
// (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY), der auf die Domain eingeschraenkt ist.

import type { GeoPoint, GeocodeResult, RouteResult } from "./geo";

function schluessel(): string {
  return (process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_KEY ?? "").trim();
}

export function googleConfigured(): boolean {
  return schluessel().length > 0;
}

// Google haengt "..., Deutschland" an jede Adresse. Fuer die Anzeige im
// Formular ist das Rauschen - die uebrigen Anbieter liefern es auch nicht.
function ohneLand(label: string): string {
  return label.replace(/,\s*(Deutschland|Germany)$/i, "");
}

/**
 * Adresssuche. Die Geocoding API kann auch mit Teileingaben umgehen und
 * liefert Koordinaten in EINEM Aufruf - anders als Places Autocomplete, das
 * einen zweiten Aufruf je Treffer braeuchte. Fuer die Adresseingabe beim
 * Bestellen reicht das; die Suche wird auf Deutschland und auf einen Kasten
 * um den Standardort eingegrenzt.
 */
export async function geocodeGoogle(query: string, limit: number, bias: GeoPoint): Promise<GeocodeResult[]> {
  const d = 0.45; // ~50 km um den Standardort - bevorzugt, nicht erzwungen
  const bounds = `${bias.lat - d},${bias.lng - d}|${bias.lat + d},${bias.lng + d}`;
  const params = new URLSearchParams({
    address: query,
    language: "de",
    region: "de",
    components: "country:DE",
    bounds,
    key: schluessel(),
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
  if (!res.ok) throw new Error(`Google Geocoding HTTP ${res.status}`);
  const data = (await res.json()) as {
    status: string;
    error_message?: string;
    results?: Array<{ formatted_address: string; geometry: { location: { lat: number; lng: number } } }>;
  };
  if (data.status === "ZERO_RESULTS") return [];
  if (data.status !== "OK") throw new Error(`Google Geocoding: ${data.status} ${data.error_message ?? ""}`.trim());
  return (data.results ?? []).slice(0, limit).map((r) => ({
    label: ohneLand(r.formatted_address),
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
  }));
}

export async function reverseGeocodeGoogle(lat: number, lng: number): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({
    latlng: `${lat},${lng}`,
    language: "de",
    result_type: "street_address|premise|route",
    key: schluessel(),
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
  if (!res.ok) throw new Error(`Google Reverse-Geocoding HTTP ${res.status}`);
  const data = (await res.json()) as {
    status: string;
    results?: Array<{ formatted_address: string; geometry: { location: { lat: number; lng: number } } }>;
  };
  const r = data.results?.[0];
  if (data.status !== "OK" || !r) return null;
  return { label: ohneLand(r.formatted_address), lat: r.geometry.location.lat, lng: r.geometry.location.lng };
}

/**
 * Strecke ueber beliebig viele Punkte (Start, Zwischenstopps, Ziel) mit der
 * Routes API. Liefert Distanz, verkehrsabhaengige Fahrzeit und den Verlauf.
 */
export async function routeGoogle(points: GeoPoint[]): Promise<RouteResult> {
  if (points.length < 2) throw new Error("Route braucht mindestens zwei Punkte.");
  const ort = (p: GeoPoint) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const body: Record<string, unknown> = {
    origin: ort(points[0]),
    destination: ort(points[points.length - 1]),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    languageCode: "de-DE",
    units: "METRIC",
  };
  if (points.length > 2) body.intermediates = points.slice(1, -1).map(ort);

  const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": schluessel(),
      // Nur anfordern, was gebraucht wird - die Feldmaske bestimmt bei Google
      // auch den Preis der Abfrage.
      "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Routes HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    routes?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }>;
  };
  const r = data.routes?.[0];
  if (!r || r.distanceMeters == null) throw new Error("Google Routes: keine Route gefunden.");
  const geometry = r.polyline?.encodedPolyline ? decodePolyline(r.polyline.encodedPolyline) : [];
  return {
    distanceMeters: Math.round(r.distanceMeters),
    // "1234s" -> 1234
    durationSeconds: Math.round(Number(String(r.duration ?? "0").replace(/s$/, "")) || 0),
    geometry: geometry.length ? geometry : points.map((p) => [p.lat, p.lng] as [number, number]),
  };
}

/** Googles kodierten Streckenverlauf in [lat, lng]-Paare umwandeln. */
export function decodePolyline(encoded: string): [number, number][] {
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
