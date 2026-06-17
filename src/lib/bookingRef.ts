// Auflösung einer Buchungs-Referenz aus der URL: akzeptiert den hochentropischen
// Tracking-Token (UUID v4, für Gast-Links /verfolgen/<token>) ODER die
// Datensatz-ID (cuid, für interne/angemeldete Aufrufe). So bleibt die Capability
// vom (teils geloggten/sichtbaren) Primärschlüssel entkoppelt.
export function bookingRefWhere(ref: string) {
  return { OR: [{ trackingToken: ref }, { id: ref }] };
}
