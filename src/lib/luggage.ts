// Gepäck-Matrix (Airport Intelligence): der Fahrgast wählt Gepäckarten, das
// System rechnet sie in Gepäckeinheiten + Sonderanforderungen um und empfiehlt
// passende Fahrzeugklassen bzw. schließt zu kleine aus. Baut auf den
// Klassen-Metadaten (seats/luggage) aus lib/vehicleClasses auf.

import { VEHICLE_CLASSES, vehicleClass, classFits } from "@/lib/vehicleClasses";

export interface LuggageItem {
  key: string;
  label: string;
  icon: string;
  units: number; // Gepäckeinheiten je Stück
  wheelchair?: boolean; // erzwingt Rollstuhltaxi
  oversize?: boolean; // braucht großen/langen Kofferraum
}

export const LUGGAGE_ITEMS: LuggageItem[] = [
  { key: "KOFFER", label: "Koffer", icon: "🧳", units: 1.5 },
  { key: "SPORT", label: "Sportgepäck", icon: "🎿", units: 3, oversize: true },
  { key: "KINDERWAGEN", label: "Kinderwagen", icon: "👶", units: 2 },
  { key: "ROLLSTUHL", label: "Rollstuhl", icon: "♿", units: 0, wheelchair: true },
];

const ITEM = new Map(LUGGAGE_ITEMS.map((i) => [i.key, i]));
const OVERSIZE_MIN_LUGGAGE = 6; // ab dieser Gepäckeinheiten-Kapazität gilt ein Wagen als "großer Kofferraum"

export interface LuggageRecommendation {
  bags: number; // gerundete Gepäckeinheiten
  requiresWheelchair: boolean;
  oversize: boolean;
  recommended: string; // Klassen-Schlüssel
  allowed: string[]; // passende Klassen
  excluded: { key: string; reason: string }[]; // ausgeschlossene Klassen + Grund
  note: string;
}

export function recommendFromLuggage(passengers: number, counts: Record<string, number>): LuggageRecommendation {
  const pax = Math.max(1, Math.floor(passengers || 1));
  let units = 0;
  let requiresWheelchair = false;
  let oversize = false;
  for (const [key, n] of Object.entries(counts)) {
    const item = ITEM.get(key);
    if (!item || !n || n <= 0) continue;
    units += item.units * n;
    if (item.wheelchair) requiresWheelchair = true;
    if (item.oversize) oversize = true;
  }
  const bags = Math.ceil(units);

  // Kandidaten: Spezialklassen (Haustier/Kindersitz) sind nicht gepäckgetrieben;
  // Rollstuhl nur, wenn auch angefragt.
  const candidates = VEHICLE_CLASSES.filter((c) => {
    if (c.wheelchair) return requiresWheelchair;
    if (c.pet || c.childSeat) return false;
    if (c.key === "SHUTTLE") return pax > 4; // Sammeltransport nur für Gruppen
    return true;
  });

  const allowedClasses = candidates.filter(
    (c) => classFits(c, { passengers: pax, luggage: bags }) && (!oversize || c.luggage >= OVERSIZE_MIN_LUGGAGE),
  );
  const allowedKeys = new Set(allowedClasses.map((c) => c.key));
  const excluded = candidates
    .filter((c) => !allowedKeys.has(c.key))
    .map((c) => ({
      key: c.key,
      reason:
        c.seats < pax
          ? `nur ${c.seats} Plätze`
          : oversize && c.luggage < OVERSIZE_MIN_LUGGAGE
          ? "Kofferraum zu klein für Sportgepäck"
          : `Kofferraum zu klein (${c.luggage} Einheiten)`,
    }));

  let recommended: string;
  if (requiresWheelchair) {
    recommended = "WHEELCHAIR";
  } else {
    const ranked = allowedClasses.slice().sort((a, b) => Number(a.premium) - Number(b.premium) || a.multiplier - b.multiplier);
    recommended = ranked[0]?.key ?? "VAN";
  }

  const note = requiresWheelchair
    ? "Rollstuhltaxi erforderlich."
    : oversize
    ? "Sportgepäck braucht einen großen Kofferraum – Kombi/Van/Shuttle empfohlen."
    : bags > vehicleClass("STANDARD").luggage
    ? "Viel Gepäck – Kombi/Van empfohlen."
    : "Standard-Taxi reicht aus.";

  return {
    bags,
    requiresWheelchair,
    oversize,
    recommended,
    allowed: allowedClasses.map((c) => c.key),
    excluded,
    note,
  };
}
