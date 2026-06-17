// Festpreis-Engine: prüft, ob eine Route (Abholung -> Ziel) in eine hinterlegte
// Festpreis-Zone eines Unternehmens fällt, und liefert den festen Preis.
//
// Eine Regel matcht, wenn die Abholung in der Start-Zone UND das Ziel in der
// Ziel-Zone liegt (Zone = Mittelpunkt + Radius). Bei bidirektionalen Regeln gilt
// auch die Gegenrichtung. Klassenspezifische Regeln greifen nur für ihre Klasse.

import { haversineMeters } from "./geo";

export interface FixedRuleLike {
  fromLat: number;
  fromLng: number;
  fromRadius: number;
  toLat: number;
  toLng: number;
  toRadius: number;
  price: number;
  bidirectional: boolean;
  vehicleClass: string | null;
  active: boolean;
}

interface Pt {
  lat: number;
  lng: number;
}

function inZone(p: Pt, lat: number, lng: number, radius: number): boolean {
  return haversineMeters(p, { lat, lng }) <= radius;
}

// Liegt die Route (pickup -> dest) in den Zonen der Regel (inkl. Gegenrichtung)?
export function routeMatchesRule(rule: FixedRuleLike, pickup: Pt, dest: Pt): boolean {
  const forward = inZone(pickup, rule.fromLat, rule.fromLng, rule.fromRadius) && inZone(dest, rule.toLat, rule.toLng, rule.toRadius);
  if (forward) return true;
  if (rule.bidirectional) {
    return inZone(pickup, rule.toLat, rule.toLng, rule.toRadius) && inZone(dest, rule.fromLat, rule.fromLng, rule.fromRadius);
  }
  return false;
}

function appliesToClass(rule: FixedRuleLike, classKey: string | null | undefined): boolean {
  if (!rule.vehicleClass) return true; // null = gilt für alle Klassen
  if (!classKey) return true; // keine Klasse angefragt -> nicht ausschließen
  return rule.vehicleClass === classKey;
}

// Min/Max der passenden Festpreise für eine Route + Klasse, oder null.
// Über mehrere Firmen hinweg liefert das die Spanne "günstigste -> teuerste Regel".
export function fixedPriceRange(
  rules: FixedRuleLike[],
  pickup: Pt,
  dest: Pt,
  classKey?: string | null,
): { min: number; max: number } | null {
  const prices: number[] = [];
  for (const r of rules) {
    if (!r.active) continue;
    if (!appliesToClass(r, classKey)) continue;
    if (routeMatchesRule(r, pickup, dest)) prices.push(r.price);
  }
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

// Konkreter Festpreis für eine Buchung (günstigste passende Regel) oder null.
export function fixedPriceFor(
  rules: FixedRuleLike[],
  pickup: Pt,
  dest: Pt,
  classKey?: string | null,
): number | null {
  const range = fixedPriceRange(rules, pickup, dest, classKey);
  return range ? range.min : null;
}
