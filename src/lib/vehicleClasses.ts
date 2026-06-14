// Fahrzeug-Marktplatz (Phase 12): Katalog der buchbaren Fahrzeugklassen.
//
// Jede Klasse hat einen plattformweiten Standard-Preisfaktor (multiplier), der
// auf den Firmen-/Plattform-Grundtarif aufschlägt. Unternehmen können diesen
// Faktor pro Klasse im Portal überschreiben (Model VehicleClassPricing) und so
// "ihre eigenen Preise" je Fahrzeugtyp setzen. Kapazität (seats) und
// Gepäckeinheiten (luggage) speisen den intelligenten Gepäckrechner.

export interface VehicleClass {
  key: string;
  label: string; // Vollname
  short: string; // Kurzform fuer enge Buttons
  icon: string; // Emoji
  seats: number; // typische Personenkapazität
  luggage: number; // Gepäckeinheiten (Koffer)
  multiplier: number; // Plattform-Standardfaktor auf den Grundtarif
  desc: string;
  // Spezialeigenschaften (fuer Filter/Sonderfahrten)
  wheelchair?: boolean;
  pet?: boolean;
  childSeat?: boolean;
  premium?: boolean;
}

// Reihenfolge = Anzeige-Reihenfolge im Kunden-Vergleich.
export const VEHICLE_CLASSES: VehicleClass[] = [
  { key: "STANDARD", label: "Standard Taxi", short: "Standard", icon: "🚕", seats: 4, luggage: 2, multiplier: 1.0, desc: "1–4 Personen, normales Gepäck" },
  { key: "VAN", label: "Großraum Taxi", short: "Großraum", icon: "🚐", seats: 8, luggage: 6, multiplier: 1.35, desc: "5–8 Personen, viel Platz" },
  { key: "EXTRA_LUGGAGE", label: "Extra-Gepäck Taxi", short: "Extra-Gepäck", icon: "🧳", seats: 4, luggage: 8, multiplier: 1.2, desc: "Großer Kofferraum für viel Gepäck" },
  { key: "SHUTTLE", label: "Shuttle / Sammeltransport", short: "Shuttle", icon: "🚌", seats: 8, luggage: 8, multiplier: 1.1, desc: "Sammeltransport für Gruppen" },
  { key: "BUSINESS", label: "Business Taxi", short: "Business", icon: "💼", seats: 4, luggage: 3, multiplier: 1.6, desc: "Gehobene Fahrzeugklasse", premium: true },
  { key: "WHEELCHAIR", label: "Rollstuhltaxi", short: "Rollstuhl", icon: "♿", seats: 3, luggage: 2, multiplier: 1.3, desc: "Barrierefrei, rollstuhlgerecht", wheelchair: true },
  { key: "PET", label: "Haustier Taxi", short: "Haustier", icon: "🐾", seats: 4, luggage: 2, multiplier: 1.15, desc: "Tiere willkommen", pet: true },
  { key: "CHILD_SEAT", label: "Kindersitz Taxi", short: "Kindersitz", icon: "👶", seats: 4, luggage: 2, multiplier: 1.05, desc: "Mit Kindersitz", childSeat: true },
  { key: "VIP", label: "Premium / VIP", short: "VIP", icon: "⭐", seats: 4, luggage: 3, multiplier: 2.0, desc: "Oberklasse-Fahrzeug, VIP-Service", premium: true },
];

export const DEFAULT_VEHICLE_CLASS = "STANDARD";

const BY_KEY = new Map(VEHICLE_CLASSES.map((c) => [c.key, c]));

export function isValidClass(key: string | null | undefined): boolean {
  return !!key && BY_KEY.has(key);
}

/** Klasse nach Schlüssel; fällt auf STANDARD zurück. */
export function vehicleClass(key?: string | null): VehicleClass {
  return (key && BY_KEY.get(key)) || BY_KEY.get(DEFAULT_VEHICLE_CLASS)!;
}

/** Plattform-Standardfaktor einer Klasse. */
export function classMultiplier(key?: string | null): number {
  return vehicleClass(key).multiplier;
}

/** Normalisiert eine evtl. fremde Eingabe auf einen gültigen Klassen-Schlüssel. */
export function normalizeClass(key?: string | null): string {
  return isValidClass(key) ? (key as string) : DEFAULT_VEHICLE_CLASS;
}

/**
 * Intelligenter Gepäckrechner: passt eine Klasse zur gewünschten Personen- und
 * Gepäckmenge? Spezialklassen (Rollstuhl/Haustier/...) gelten nur dann als
 * "Treffer", wenn ihre Eigenschaft auch angefragt wurde.
 */
export function classFits(
  c: VehicleClass,
  req: { passengers?: number; luggage?: number },
): boolean {
  const pax = req.passengers ?? 1;
  const bags = req.luggage ?? 0;
  return c.seats >= pax && c.luggage >= bags;
}

/**
 * Empfehlung für den Gepäckrechner: günstigste passende Standardklasse plus
 * Hinweis, ob bei großen Gruppen mehrere Fahrzeuge nötig sind.
 */
export function suggestForLoad(req: { passengers?: number; luggage?: number }): {
  recommended: string | null;
  needsMultiple: boolean;
} {
  const pax = req.passengers ?? 1;
  const bags = req.luggage ?? 0;
  const fitting = VEHICLE_CLASSES.filter(
    (c) => !c.wheelchair && !c.pet && !c.childSeat && classFits(c, { passengers: pax, luggage: bags }),
  ).sort((a, b) => a.multiplier - b.multiplier);
  const maxSeats = Math.max(...VEHICLE_CLASSES.map((c) => c.seats));
  return {
    recommended: fitting[0]?.key ?? null,
    needsMultiple: pax > maxSeats || bags > Math.max(...VEHICLE_CLASSES.map((c) => c.luggage)),
  };
}

// --- Gruppen-/Eventbuchung (Phase 13): Flottenzusammenstellung -------------

export interface FleetVehicle {
  classKey: string;
  count: number;
}

export interface FleetOption {
  id: string;
  label: string;
  vehicles: FleetVehicle[];
  totalSeats: number;
  totalLuggage: number;
  vehicleCount: number;
}

const MAX_GROUP_VEHICLES = 100;

function vehiclesNeeded(c: VehicleClass, pax: number, bags: number): number {
  return Math.max(1, Math.ceil(pax / c.seats), Math.ceil(bags / Math.max(1, c.luggage)));
}

function buildOption(id: string, label: string, classKey: string, count: number): FleetOption {
  const c = vehicleClass(classKey);
  return {
    id,
    label,
    vehicles: [{ classKey: c.key, count }],
    totalSeats: c.seats * count,
    totalLuggage: c.luggage * count,
    vehicleCount: count,
  };
}

/**
 * Schlägt für eine Gruppe (Personen + Gepäck) mehrere Flotten-Optionen vor:
 * komplett Standard, komplett Großraum und – falls sinnvoll – Shuttle.
 * Doppelte Optionen (gleiche Fahrzeugzahl/Klasse) werden zusammengefasst.
 */
export function suggestFleet(passengers: number, luggage: number): FleetOption[] {
  const pax = Math.max(1, Math.floor(passengers || 1));
  const bags = Math.max(0, Math.floor(luggage || 0));

  const stdCount = vehiclesNeeded(vehicleClass("STANDARD"), pax, bags);
  const vanCount = vehiclesNeeded(vehicleClass("VAN"), pax, bags);
  const shuttleCount = vehiclesNeeded(vehicleClass("SHUTTLE"), pax, bags);

  const raw: FleetOption[] = [
    buildOption("van", `${vanCount}× Großraum`, "VAN", vanCount),
    buildOption("standard", `${stdCount}× Standard`, "STANDARD", stdCount),
  ];
  // Shuttle nur anbieten, wenn es echte Sammeltransporte sind (große Gruppe).
  if (pax > 8) raw.push(buildOption("shuttle", `${shuttleCount}× Shuttle`, "SHUTTLE", shuttleCount));

  // Nur Optionen, die wirklich passen und die Fahrzeug-Obergrenze einhalten.
  const seen = new Set<string>();
  return raw
    .filter((o) => o.totalSeats >= pax && o.totalLuggage >= bags && o.vehicleCount <= MAX_GROUP_VEHICLES)
    .filter((o) => {
      const key = `${o.vehicles[0].classKey}x${o.vehicles[0].count}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.vehicleCount - b.vehicleCount);
}

/** Validiert/normalisiert eine gewählte Flotte und berechnet die Kapazität. */
export function buildFleet(vehicles: FleetVehicle[]): {
  vehicles: FleetVehicle[];
  vehicleCount: number;
  totalSeats: number;
  totalLuggage: number;
} {
  const norm = vehicles
    .map((v) => ({ classKey: normalizeClass(v.classKey), count: Math.max(0, Math.floor(v.count || 0)) }))
    .filter((v) => v.count > 0);
  const vehicleCount = norm.reduce((s, v) => s + v.count, 0);
  const totalSeats = norm.reduce((s, v) => s + vehicleClass(v.classKey).seats * v.count, 0);
  const totalLuggage = norm.reduce((s, v) => s + vehicleClass(v.classKey).luggage * v.count, 0);
  return { vehicles: norm, vehicleCount, totalSeats, totalLuggage };
}

export { MAX_GROUP_VEHICLES };
