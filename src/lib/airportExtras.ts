// Airport-Extras: Meet & Greet Service-Stufen (mit flughafenabhängigem Aufpreis)
// und Wartezeit-Fairpreis (Freikontingent nach Ankunft, danach pro Minute).

export interface MeetGreetLevel {
  key: string;
  label: string;
  desc: string;
  fee: number; // Basis-Aufschlag (EUR), vor Flughafenfaktor
}

export const MEET_GREET_LEVELS: MeetGreetLevel[] = [
  { key: "BASIC", label: "Pickup-Zone", desc: "Treffpunkt an der Abholzone", fee: 0 },
  { key: "TERMINAL", label: "Terminal-Abholung", desc: "Fahrer wartet am Terminal-Ausgang", fee: 8 },
  { key: "PREMIUM", label: "Premium Meet & Greet", desc: "Fahrer mit Namensschild + Gepäckhilfe", fee: 20 },
];

const BY_KEY = new Map(MEET_GREET_LEVELS.map((l) => [l.key, l]));

// Große Flughäfen sind teurer (Faktor auf die Service-Gebühr). Erkennung per
// Stichwort in der Adresse (IATA oder Stadt), best effort.
const BIG_AIRPORTS = [
  "münchen", "muenchen", "frankfurt", "düsseldorf", "duesseldorf", "hamburg",
  "berlin", "stuttgart", "köln", "koeln", "muc", "fra", "dus", "ham", "ber", "str", "cgn",
];

export function airportFactor(...addresses: (string | null | undefined)[]): number {
  const hay = addresses.filter(Boolean).join(" ").toLowerCase();
  return BIG_AIRPORTS.some((k) => hay.includes(k)) ? 1.5 : 1.0;
}

export function meetGreetFee(level: string | null | undefined, ...airportAddresses: (string | null | undefined)[]): number {
  const lv = level ? BY_KEY.get(level) : null;
  if (!lv || lv.fee === 0) return 0;
  return Math.round(lv.fee * airportFactor(...airportAddresses) * 100) / 100;
}

export function meetGreetLabel(level: string | null | undefined): string | null {
  return level ? BY_KEY.get(level)?.label ?? null : null;
}

// ── Wartezeit-Fairpreis ────────────────────────────────────────────────────
// Nach Ankunft des Fahrers sind die ersten Minuten frei; danach pro Minute.
// Flugverspätungen werden bereits über die angepasste Abholzeit fair behandelt
// (siehe scheduler/flights) – hier zählt nur die tatsächliche Standzeit.
export const FREE_WAIT_MIN = 15;
export const WAIT_PER_MIN = 0.5;

export function waitCharge(arrivedAt?: Date | null, startedAt?: Date | null): { minutes: number; fee: number } {
  if (!arrivedAt || !startedAt) return { minutes: 0, fee: 0 };
  const total = Math.max(0, Math.round((startedAt.getTime() - arrivedAt.getTime()) / 60_000));
  const billable = Math.max(0, total - FREE_WAIT_MIN);
  return { minutes: billable, fee: Math.round(billable * WAIT_PER_MIN * 100) / 100 };
}
