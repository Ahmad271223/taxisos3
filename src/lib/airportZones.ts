// Airport-Navigation: kuratierter Katalog von Abhol-Treffpunkten (Pickup-Zonen)
// großer deutscher Flughäfen. Statt Indoor-Mapping (externe Daten) liefern wir
// pro Terminal einen exakten, benannten Treffpunkt mit GPS – das deckt
// Terminal-Zuordnung + „Zone X – Terminal Y" + Karten-Link ab.

export interface PickupZone {
  code: string; // kurze Zonenkennung, z. B. "T2-A"
  label: string; // Klartext-Treffpunkt
  lat: number;
  lng: number;
  terminals?: string[]; // passende Terminals (leer = gilt für alle)
}

export interface AirportInfo {
  iata: string;
  name: string;
  cities: string[]; // schwache Erkennung – zählt NUR mit Flughafen-Kontext
  strong: string[]; // eindeutige Begriffe – matchen direkt (kein Stadtname!)
  zones: PickupZone[];
}

export const AIRPORTS: AirportInfo[] = [
  {
    iata: "MUC", name: "Flughafen München", cities: ["münchen", "muenchen"],
    strong: ["flughafen münchen", "flughafen muenchen", "franz josef strau", "franz-josef-strau", "muc airport"],
    zones: [
      { code: "T1-AnkE03", label: "Terminal 1, Ankunft Ebene 03 – Kurzhalt", lat: 48.3539, lng: 11.7861, terminals: ["1"] },
      { code: "T2-AnkE03", label: "Terminal 2, Ankunft Ebene 03 – Vorfahrt", lat: 48.3531, lng: 11.7896, terminals: ["2"] },
    ],
  },
  {
    iata: "FRA", name: "Flughafen Frankfurt", cities: ["frankfurt"],
    strong: ["fraport", "flughafen frankfurt"],
    zones: [
      { code: "T1-Ank", label: "Terminal 1, Ankunft – Taxistand", lat: 50.0512, lng: 8.5705, terminals: ["1"] },
      { code: "T2-Ank", label: "Terminal 2, Ankunft – Taxistand", lat: 50.0533, lng: 8.5875, terminals: ["2"] },
    ],
  },
  {
    iata: "DUS", name: "Flughafen Düsseldorf", cities: ["düsseldorf", "duesseldorf"],
    strong: ["flughafen düsseldorf", "flughafen duesseldorf"],
    zones: [{ code: "Ank-Taxi", label: "Ankunftsebene – Taxi/Abholung", lat: 51.2785, lng: 6.7668 }],
  },
  {
    iata: "HAM", name: "Flughafen Hamburg", cities: ["hamburg"],
    strong: ["fuhlsbüttel", "fuhlsbuettel", "flughafen hamburg", "helmut schmidt"],
    zones: [{ code: "Ank-Taxi", label: "Ankunft – Vorfahrt/Taxi", lat: 53.6304, lng: 9.9882 }],
  },
  {
    iata: "BER", name: "Flughafen Berlin Brandenburg", cities: ["berlin"],
    strong: ["flughafen berlin", "willy brandt", "schönefeld", "schoenefeld", "ber airport"],
    zones: [{ code: "T1-Ank", label: "Terminal 1, Ankunft – Ebene U2 Vorfahrt", lat: 52.3667, lng: 13.5033, terminals: ["1"] }],
  },
  {
    iata: "STR", name: "Flughafen Stuttgart", cities: ["stuttgart"],
    strong: ["echterdingen", "flughafen stuttgart"],
    zones: [{ code: "Ank-Taxi", label: "Ankunft – Taxi/Abholung", lat: 48.6899, lng: 9.2218 }],
  },
  {
    iata: "CGN", name: "Flughafen Köln/Bonn", cities: ["köln", "koeln", "bonn"],
    strong: ["flughafen köln", "flughafen koeln", "köln/bonn", "koeln/bonn", "konrad adenauer", "wahn"],
    zones: [{ code: "T1-Ank", label: "Terminal 1, Ankunft – Vorfahrt", lat: 50.8659, lng: 7.1427, terminals: ["1"] }],
  },
  {
    iata: "HAJ", name: "Flughafen Hannover", cities: ["hannover"],
    strong: ["langenhagen", "flughafen hannover"],
    zones: [{ code: "Ank-Taxi", label: "Ankunft – Taxistand vor der Halle", lat: 52.4611, lng: 9.685 }],
  },
];

// Findet den Flughafen anhand eines Texts. Stadtnamen zählen nur, wenn der Text
// auch „Flughafen"/„Airport" enthält – sonst würde jede Stadtadresse matchen.
export function findAirport(...texts: (string | null | undefined)[]): AirportInfo | null {
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  if (!hay.trim()) return null;
  const airportContext = /flughafen|airport/.test(hay);
  for (const a of AIRPORTS) {
    if (a.strong.some((k) => hay.includes(k))) return a;
    if (airportContext && a.cities.some((k) => hay.includes(k))) return a;
  }
  return null;
}

export interface ResolvedPickup {
  airportIata: string;
  airportName: string;
  zone: PickupZone;
}

// Treffpunkt für eine Abholung an einem Flughafen ermitteln (anhand Abholadresse
// + optional Terminal). null, wenn die Abholung an keinem bekannten Flughafen liegt.
export function resolveAirportPickup(pickupAddress: string | null | undefined, terminal?: string | null): ResolvedPickup | null {
  const airport = findAirport(pickupAddress);
  if (!airport || airport.zones.length === 0) return null;
  const t = (terminal ?? "").trim();
  const zone = (t && airport.zones.find((z) => z.terminals?.includes(t))) || airport.zones[0];
  return { airportIata: airport.iata, airportName: airport.name, zone };
}
