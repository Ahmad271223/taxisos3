// Preis-Erweiterungen der Festpreis-Engine (alle Werte 0 = aus, dann No-Op):
//  - Krankenkassen-/DTA-Tarif (payerType INSURANCE): fester Tarif statt Markt.
//  - Risiko-Buffer: Meter-Schätzpreis + X % als garantierter dynamischer Festpreis.
//  - Pro-Stopp-Gebühr: Aufschlag je Zwischenstopp.
//  - Preisuntergrenze: globaler Mindest-Endpreis (gegen ruinöses Unterbieten).

export interface PlatformConfigLike {
  minBaseFare: number;
  minPerKm: number;
  insuranceBaseFare: number;
  insurancePerKm: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Krankenkassen-/DTA-Tarif für Kassenfahrten. null = nicht konfiguriert.
export function insuranceFare(km: number, cfg: PlatformConfigLike): number | null {
  if (!cfg.insuranceBaseFare && !cfg.insurancePerKm) return null;
  return r2(Math.max(0, (cfg.insuranceBaseFare || 0) + (cfg.insurancePerKm || 0) * Math.max(0, km)));
}

// Dynamischer Festpreis: Meter-Schätzpreis + Risiko-Buffer (%). 0 = aus -> null.
export function riskBufferFare(meteredPrice: number, bufferPct: number): number | null {
  if (!bufferPct || bufferPct <= 0) return null;
  return r2(Math.max(0, meteredPrice) * (1 + bufferPct / 100));
}

// Aufschlag für Zwischenstopps.
export function stopSurcharge(numStops: number, perStopFee: number): number {
  if (!perStopFee || perStopFee <= 0 || numStops <= 0) return 0;
  return r2(numStops * perStopFee);
}

// Globale Preisuntergrenze (Mindest-Endpreis) für die Strecke.
export function fareFloor(km: number, cfg: PlatformConfigLike): number {
  return r2(Math.max(0, (cfg.minBaseFare || 0) + (cfg.minPerKm || 0) * Math.max(0, km)));
}

// Wendet die Untergrenze an: Endpreis nie unter dem Floor.
export function applyFloor(fare: number, km: number, cfg: PlatformConfigLike): number {
  return r2(Math.max(fare, fareFloor(km, cfg)));
}
