// Flughafen-Stammdaten (IATA -> Koordinaten), um nach dem Flug-Lookup den
// Flughafen im Buchungsformular automatisch zu setzen (Adresse + Pin). Schwerpunkt
// Deutschland + die von dort meistgeflogenen internationalen Ziele.

export interface Airport {
  iata: string;
  name: string;
  lat: number;
  lng: number;
}

const AIRPORTS: Record<string, { name: string; lat: number; lng: number }> = {
  // Deutschland
  FRA: { name: "Frankfurt Airport", lat: 50.0379, lng: 8.5622 },
  MUC: { name: "München Franz Josef Strauß", lat: 48.3538, lng: 11.7861 },
  BER: { name: "Berlin Brandenburg", lat: 52.3667, lng: 13.5033 },
  HAM: { name: "Hamburg Airport", lat: 53.6304, lng: 9.9882 },
  DUS: { name: "Düsseldorf Airport", lat: 51.2895, lng: 6.7668 },
  CGN: { name: "Köln/Bonn Airport", lat: 50.8659, lng: 7.1427 },
  STR: { name: "Stuttgart Airport", lat: 48.6899, lng: 9.222 },
  HAJ: { name: "Hannover Airport", lat: 52.4611, lng: 9.685 },
  NUE: { name: "Nürnberg Airport", lat: 49.4987, lng: 11.078 },
  LEJ: { name: "Leipzig/Halle Airport", lat: 51.4239, lng: 12.2364 },
  BRE: { name: "Bremen Airport", lat: 53.0475, lng: 8.7867 },
  DTM: { name: "Dortmund Airport", lat: 51.5183, lng: 7.6122 },
  FMO: { name: "Münster/Osnabrück", lat: 52.1346, lng: 7.6848 },
  FKB: { name: "Karlsruhe/Baden-Baden", lat: 48.7794, lng: 8.0805 },
  FDH: { name: "Friedrichshafen", lat: 47.6713, lng: 9.5115 },
  PAD: { name: "Paderborn/Lippstadt", lat: 51.6141, lng: 8.6163 },
  FMM: { name: "Memmingen Allgäu", lat: 47.9888, lng: 10.2395 },
  DRS: { name: "Dresden Airport", lat: 51.1328, lng: 13.7672 },
  ERF: { name: "Erfurt/Weimar", lat: 50.9798, lng: 10.9581 },
  SCN: { name: "Saarbrücken Airport", lat: 49.2146, lng: 7.1095 },
  NRN: { name: "Weeze (Niederrhein)", lat: 51.6024, lng: 6.1422 },
  HHN: { name: "Frankfurt-Hahn", lat: 49.9487, lng: 7.2639 },
  // Europa (häufige Ziele)
  LHR: { name: "London Heathrow", lat: 51.47, lng: -0.4543 },
  LGW: { name: "London Gatwick", lat: 51.1537, lng: -0.1821 },
  CDG: { name: "Paris Charles de Gaulle", lat: 49.0097, lng: 2.5479 },
  ORY: { name: "Paris Orly", lat: 48.7233, lng: 2.3794 },
  AMS: { name: "Amsterdam Schiphol", lat: 52.3105, lng: 4.7683 },
  BRU: { name: "Brüssel Airport", lat: 50.9014, lng: 4.4844 },
  ZRH: { name: "Zürich Airport", lat: 47.4582, lng: 8.5555 },
  GVA: { name: "Genf Airport", lat: 46.2381, lng: 6.109 },
  VIE: { name: "Wien-Schwechat", lat: 48.1103, lng: 16.5697 },
  MAD: { name: "Madrid-Barajas", lat: 40.4983, lng: -3.5676 },
  BCN: { name: "Barcelona-El Prat", lat: 41.2974, lng: 2.0833 },
  FCO: { name: "Rom Fiumicino", lat: 41.8003, lng: 12.2389 },
  MXP: { name: "Mailand Malpensa", lat: 45.6306, lng: 8.7281 },
  LIS: { name: "Lissabon Airport", lat: 38.7742, lng: -9.1342 },
  IST: { name: "Istanbul Airport", lat: 41.2753, lng: 28.7519 },
  AYT: { name: "Antalya Airport", lat: 36.8987, lng: 30.8005 },
  PMI: { name: "Palma de Mallorca", lat: 39.5517, lng: 2.7388 },
  CPH: { name: "Kopenhagen-Kastrup", lat: 55.618, lng: 12.6508 },
  ARN: { name: "Stockholm Arlanda", lat: 59.6519, lng: 17.9186 },
  OSL: { name: "Oslo Gardermoen", lat: 60.1939, lng: 11.1004 },
  HEL: { name: "Helsinki-Vantaa", lat: 60.3172, lng: 24.9633 },
  WAW: { name: "Warschau Chopin", lat: 52.1657, lng: 20.9671 },
  PRG: { name: "Prag Václav Havel", lat: 50.1008, lng: 14.26 },
  ATH: { name: "Athen Airport", lat: 37.9364, lng: 23.9445 },
  // Interkontinental (Auswahl)
  DXB: { name: "Dubai International", lat: 25.2532, lng: 55.3657 },
  JFK: { name: "New York JFK", lat: 40.6413, lng: -73.7781 },
  EWR: { name: "Newark Liberty", lat: 40.6895, lng: -74.1745 },
  LAX: { name: "Los Angeles International", lat: 33.9416, lng: -118.4085 },
  ORD: { name: "Chicago O'Hare", lat: 41.9742, lng: -87.9073 },
  YYZ: { name: "Toronto Pearson", lat: 43.6777, lng: -79.6248 },
  SIN: { name: "Singapur Changi", lat: 1.3644, lng: 103.9915 },
  HND: { name: "Tokio Haneda", lat: 35.5494, lng: 139.7798 },
  PEK: { name: "Peking Capital", lat: 40.0799, lng: 116.6031 },
  DEL: { name: "Delhi Indira Gandhi", lat: 28.5562, lng: 77.1 },
  BKK: { name: "Bangkok Suvarnabhumi", lat: 13.69, lng: 100.7501 },
};

export function airportByIata(iata: string | null | undefined): Airport | null {
  if (!iata) return null;
  const a = AIRPORTS[iata.toUpperCase()];
  return a ? { iata: iata.toUpperCase(), name: a.name, lat: a.lat, lng: a.lng } : null;
}
