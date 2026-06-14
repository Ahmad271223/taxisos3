// Geokodierung (Photon/Komoot + Nominatim-Fallback), Routing/Distanz (OSRM)
// und Preisberechnung. Alle Dienste sind frei und ohne API-Key nutzbar.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
}

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  geometry?: [number, number][]; // [lat, lng] entlang der Strecke
}

export interface PriceEstimate {
  distanceMeters: number;
  durationSeconds: number;
  priceMin: number;
  priceMax: number;
  priceMid: number;
  geometry?: [number, number][];
}

const PHOTON = "https://photon.komoot.io";
const NOMINATIM = "https://nominatim.openstreetmap.org";
const OSRM = "https://router.project-osrm.org";
const USER_AGENT = "TaxiConnect/0.1 (Taxi-Dispatch Hannover)";

// --- Geocoder/Router-Anbieter ---------------------------------------------
// Kommerziell nutzbarer Anbieter via Env. Ohne Key -> freie OSM-Dienste
// (Photon/Nominatim/OSRM) als Fallback (nur Entwicklung/Tests; deren ToS
// untersagen kommerzielle Last). Auto-Auswahl: Mapbox > LocationIQ > frei,
// oder explizit per GEO_PROVIDER.
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
const LOCATIONIQ_KEY = process.env.LOCATIONIQ_KEY;
const LOCATIONIQ_REGION = process.env.LOCATIONIQ_REGION ?? "eu1";

type GeoProvider = "mapbox" | "locationiq" | "free";

function geoProvider(): GeoProvider {
  const p = (process.env.GEO_PROVIDER ?? "").toLowerCase();
  if (p === "mapbox" || p === "locationiq" || p === "free") return p as GeoProvider;
  if (MAPBOX_TOKEN) return "mapbox";
  if (LOCATIONIQ_KEY) return "locationiq";
  return "free";
}

// Ist ein kommerzieller Anbieter konfiguriert?
export function geocoderConfigured(): boolean {
  return geoProvider() !== "free";
}

// Directions-URL je Anbieter. Mapbox- UND LocationIQ-Routing liefern OSRM-Format,
// daher ein gemeinsamer Parser.
function directionsUrl(coords: string): string {
  const p = geoProvider();
  if (p === "mapbox") {
    return `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?overview=full&geometries=geojson&access_token=${MAPBOX_TOKEN}`;
  }
  if (p === "locationiq") {
    return `https://${LOCATIONIQ_REGION}.locationiq.com/v1/directions/driving/${coords}?overview=full&geometries=geojson&key=${LOCATIONIQ_KEY}`;
  }
  return `${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
}

function biasCenter(): GeoPoint {
  return {
    lat: Number(process.env.DEFAULT_LAT ?? 52.375892),
    lng: Number(process.env.DEFAULT_LNG ?? 9.732010),
  };
}

// Haversine-Distanz in Metern (Luftlinie) – fuer die Fahrerauswahl.
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function photonLabel(props: any): string {
  const street = [props.street ?? props.name, props.housenumber].filter(Boolean).join(" ");
  const place = [props.postcode, props.city ?? props.town ?? props.village ?? props.county]
    .filter(Boolean)
    .join(" ");
  const parts = [street || props.name, place].filter(Boolean);
  // Falls name != street zusaetzlich anzeigen (z. B. POI-Name)
  if (props.name && props.street && props.name !== props.street) {
    parts.unshift(props.name);
  }
  return Array.from(new Set(parts)).join(", ");
}

// Adress-Autovervollstaendigung via Photon (Komoot) – auf Hannover ausgerichtet.
async function geocodePhoton(query: string, limit: number): Promise<GeocodeResult[]> {
  const c = biasCenter();
  const url = `${PHOTON}/api/?q=${encodeURIComponent(query)}&lang=de&limit=${limit}&lat=${c.lat}&lon=${c.lng}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: any[] };
  const out: GeocodeResult[] = [];
  for (const f of data.features ?? []) {
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    out.push({ label: photonLabel(f.properties ?? {}), lat: coords[1], lng: coords[0] });
  }
  return out;
}

// Fallback: Nominatim (OpenStreetMap).
async function geocodeNominatim(query: string, limit: number): Promise<GeocodeResult[]> {
  const url = `${NOMINATIM}/search?format=jsonv2&addressdetails=0&limit=${limit}&countrycodes=de&q=${encodeURIComponent(
    query,
  )}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "de" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return data.map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }));
}

// LocationIQ-Suche (Nominatim-kompatibles Format) – via API-Key.
async function geocodeLocationIQ(query: string, limit: number): Promise<GeocodeResult[]> {
  const url = `https://${LOCATIONIQ_REGION}.locationiq.com/v1/search?key=${LOCATIONIQ_KEY}&q=${encodeURIComponent(
    query,
  )}&format=json&limit=${limit}&countrycodes=de&accept-language=de&addressdetails=0`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
  return (Array.isArray(data) ? data : []).map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }));
}

// Mapbox Geocoding v6 (GeoJSON) – via Access-Token, auf Hannover gebiast.
async function geocodeMapbox(query: string, limit: number): Promise<GeocodeResult[]> {
  const c = biasCenter();
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(
    query,
  )}&access_token=${MAPBOX_TOKEN}&country=de&language=de&limit=${limit}&proximity=${c.lng},${c.lat}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return [];
  const data = (await res.json()) as { features?: any[] };
  const out: GeocodeResult[] = [];
  for (const f of data.features ?? []) {
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    const label = f.properties?.full_address ?? f.properties?.name ?? f.properties?.place_formatted ?? "";
    out.push({ label, lat: coords[1], lng: coords[0] });
  }
  return out;
}

export async function geocode(query: string, limit = 6): Promise<GeocodeResult[]> {
  if (!query || query.trim().length < 2) return [];
  const p = geoProvider();
  try {
    if (p === "mapbox") return await geocodeMapbox(query, limit);
    if (p === "locationiq") return await geocodeLocationIQ(query, limit);
  } catch {
    return []; // kommerzieller Anbieter konfiguriert -> NICHT auf freie Dienste ausweichen (ToS)
  }
  // Frei (nur Dev/Test): Photon -> Nominatim.
  try {
    const photon = await geocodePhoton(query, limit);
    if (photon.length) return photon;
  } catch {
    /* fallback */
  }
  try {
    return await geocodeNominatim(query, limit);
  } catch {
    return [];
  }
}

// Reverse-Geocoding (Koordinate -> Adresse), anbieterabhängig.
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
  const p = geoProvider();
  try {
    if (p === "mapbox") {
      const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&access_token=${MAPBOX_TOKEN}&language=de`;
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.ok) {
        const d = (await res.json()) as { features?: any[] };
        const f = d.features?.[0];
        if (f) {
          const label = f.properties?.full_address ?? f.properties?.name ?? "";
          return { label, lat: f.geometry?.coordinates?.[1] ?? lat, lng: f.geometry?.coordinates?.[0] ?? lng };
        }
      }
      return null;
    }
    const base =
      p === "locationiq"
        ? `https://${LOCATIONIQ_REGION}.locationiq.com/v1/reverse?key=${LOCATIONIQ_KEY}&lat=${lat}&lon=${lng}&format=json&accept-language=de`
        : `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=de`;
    const res = await fetch(base, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "de" } });
    if (res.ok) {
      const d = (await res.json()) as { display_name?: string; lat?: string; lon?: string };
      if (d.display_name) return { label: d.display_name, lat: Number(d.lat ?? lat), lng: Number(d.lon ?? lng) };
    }
  } catch {
    /* null */
  }
  return null;
}

// Eine einzelne, beste Treffer-Koordinate (fuer "Adresse beim Bestellen erkennen").
export async function geocodeOne(query: string): Promise<GeocodeResult | null> {
  const results = await geocode(query, 1);
  return results[0] ?? null;
}

// Strassen-Route fuer Distanz, Fahrzeit und Streckenverlauf. Faellt bei Fehler
// auf eine Luftlinien-Schaetzung zurueck.
export async function routeBetween(from: GeoPoint, to: GeoPoint): Promise<RouteResult> {
  const url = directionsUrl(`${from.lng},${from.lat};${to.lng},${to.lat}`);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) {
      const data = (await res.json()) as {
        code: string;
        routes?: Array<{ distance: number; duration: number; geometry?: { coordinates: [number, number][] } }>;
      };
      const r = data.routes?.[0];
      if (data.code === "Ok" && r) {
        const geometry = (r.geometry?.coordinates ?? []).map(
          (c) => [c[1], c[0]] as [number, number],
        );
        return {
          distanceMeters: Math.round(r.distance),
          durationSeconds: Math.round(r.duration),
          geometry: geometry.length ? geometry : [[from.lat, from.lng], [to.lat, to.lng]],
        };
      }
    }
  } catch {
    /* ignore -> fallback */
  }
  const straight = haversineMeters(from, to);
  const distanceMeters = Math.round(straight * 1.35);
  const durationSeconds = Math.round((distanceMeters / 1000 / 30) * 3600);
  return {
    distanceMeters,
    durationSeconds,
    geometry: [[from.lat, from.lng], [to.lat, to.lng]],
  };
}

// Mehrziel-Route ueber beliebig viele Wegpunkte (Phase 2e). OSRM berechnet die
// Gesamtstrecke in einem Request, wenn alle Punkte ;-getrennt uebergeben werden.
// Faellt bei Fehler auf die Summe der Luftlinien-Etappen zurueck.
export async function routeVia(points: GeoPoint[]): Promise<RouteResult> {
  const pts = points.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (pts.length < 2) {
    const p = pts[0] ?? biasCenter();
    return { distanceMeters: 0, durationSeconds: 0, geometry: [[p.lat, p.lng]] };
  }
  if (pts.length === 2) return routeBetween(pts[0], pts[1]);

  const coords = pts.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = directionsUrl(coords);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) {
      const data = (await res.json()) as {
        code: string;
        routes?: Array<{ distance: number; duration: number; geometry?: { coordinates: [number, number][] } }>;
      };
      const r = data.routes?.[0];
      if (data.code === "Ok" && r) {
        const geometry = (r.geometry?.coordinates ?? []).map((c) => [c[1], c[0]] as [number, number]);
        return {
          distanceMeters: Math.round(r.distance),
          durationSeconds: Math.round(r.duration),
          geometry: geometry.length ? geometry : pts.map((p) => [p.lat, p.lng] as [number, number]),
        };
      }
    }
  } catch {
    /* ignore -> fallback */
  }
  // Fallback: Etappen-Luftlinien aufsummieren.
  let straight = 0;
  for (let i = 1; i < pts.length; i++) straight += haversineMeters(pts[i - 1], pts[i]);
  const distanceMeters = Math.round(straight * 1.35);
  const durationSeconds = Math.round((distanceMeters / 1000 / 30) * 3600);
  return {
    distanceMeters,
    durationSeconds,
    geometry: pts.map((p) => [p.lat, p.lng] as [number, number]),
  };
}

interface EnvTariff {
  base: number;
  perKm: number;
  perMin: number;
}

export function getTariff(): EnvTariff {
  return {
    base: Number(process.env.TARIFF_BASE ?? 3.9),
    perKm: Number(process.env.TARIFF_PER_KM ?? 2.2),
    perMin: Number(process.env.TARIFF_PER_MIN ?? 0.4),
  };
}

export function priceFromRoute(distanceMeters: number, durationSeconds: number): Omit<PriceEstimate, "geometry"> {
  const t = getTariff();
  const km = distanceMeters / 1000;
  const min = durationSeconds / 60;
  const mid = t.base + km * t.perKm + min * t.perMin;
  const priceMin = Math.max(t.base, Math.round(mid * 0.9 * 100) / 100);
  const priceMax = Math.round(mid * 1.15 * 100) / 100;
  return {
    distanceMeters,
    durationSeconds,
    priceMid: Math.round(mid * 100) / 100,
    priceMin,
    priceMax,
  };
}

export async function estimatePrice(from: GeoPoint, to: GeoPoint): Promise<PriceEstimate> {
  const route = await routeBetween(from, to);
  return { ...priceFromRoute(route.distanceMeters, route.durationSeconds), geometry: route.geometry };
}

// --- Mandantenfaehige, zeitabhaengige Preisberechnung ----------------------

export interface PricingConfig {
  basePrice: number;
  perKmDay: number;
  perKmNight: number;
  perKmWeekend: number;
  perMinute: number;
  nightStartHour: number;
  nightEndHour: number;
}

export const DEFAULT_PRICING: PricingConfig = {
  basePrice: 4.0,
  perKmDay: 2.5,
  perKmNight: 3.2,
  perKmWeekend: 2.8,
  perMinute: 0.0,
  nightStartHour: 22,
  nightEndHour: 6,
};

export type Tariff = "TAG" | "NACHT" | "WOCHENENDE";

// Aktiven Tarif anhand Wochentag/Uhrzeit bestimmen.
export function activeTariff(p: PricingConfig, when: Date = new Date()): { perKm: number; tariff: Tariff } {
  const day = when.getDay(); // 0 = So, 6 = Sa
  if (day === 0 || day === 6) return { perKm: p.perKmWeekend, tariff: "WOCHENENDE" };
  const h = when.getHours();
  const isNight =
    p.nightStartHour > p.nightEndHour
      ? h >= p.nightStartHour || h < p.nightEndHour // z. B. 22..6
      : h >= p.nightStartHour && h < p.nightEndHour;
  return isNight ? { perKm: p.perKmNight, tariff: "NACHT" } : { perKm: p.perKmDay, tariff: "TAG" };
}

export interface PriceEstimateT extends PriceEstimate {
  tariff: Tariff;
}

export function priceWithConfig(
  distanceMeters: number,
  durationSeconds: number,
  p: PricingConfig,
  when: Date = new Date(),
): Omit<PriceEstimateT, "geometry"> {
  const { perKm, tariff } = activeTariff(p, when);
  const km = distanceMeters / 1000;
  const min = durationSeconds / 60;
  const mid = p.basePrice + km * perKm + min * p.perMinute;
  const priceMin = Math.max(p.basePrice, Math.round(mid * 0.9 * 100) / 100);
  const priceMax = Math.round(mid * 1.15 * 100) / 100;
  return {
    distanceMeters,
    durationSeconds,
    priceMid: Math.round(mid * 100) / 100,
    priceMin,
    priceMax,
    tariff,
  };
}

export async function estimatePriceWith(
  from: GeoPoint,
  to: GeoPoint,
  p: PricingConfig,
  when: Date = new Date(),
): Promise<PriceEstimateT> {
  const route = await routeBetween(from, to);
  return {
    ...priceWithConfig(route.distanceMeters, route.durationSeconds, p, when),
    geometry: route.geometry,
  };
}

// Mehrziel-Variante: Gesamtpreis ueber Abholung -> Stopps -> Ziel (Phase 2e/2f).
export async function estimatePriceViaWith(
  points: GeoPoint[],
  p: PricingConfig,
  when: Date = new Date(),
): Promise<PriceEstimateT> {
  const route = await routeVia(points);
  return {
    ...priceWithConfig(route.distanceMeters, route.durationSeconds, p, when),
    geometry: route.geometry,
  };
}
