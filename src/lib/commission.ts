// KEINE Plattform-Provision pro Fahrt.
//
// Geschaeftsmodell: die Plattform verdient ausschliesslich am monatlichen
// Unternehmens-Abo (siehe lib/plans.ts). Der komplette Fahrpreis gehoert dem
// Taxiunternehmen; bei Kartenzahlung geht das Geld per Stripe Connect direkt
// auf dessen Auszahlungskonto (siehe lib/stripe.ts).
//
// Die Funktionen bleiben erhalten (0 %), damit bestehende Auswertungen,
// Rechnungen und gespeicherte Altdaten weiter funktionieren.

export const COMMISSION_RATE = 0;

export function commissionRate(_cityTier?: string | null): number {
  return COMMISSION_RATE;
}

export interface CommissionBreakdown {
  rate: number;
  platformFee: number;
  companyNet: number;
}

export function computeCommission(fare: number, _cityTier?: string | null): CommissionBreakdown {
  const net = Math.round(fare * 100) / 100;
  return { rate: 0, platformFee: 0, companyNet: net };
}
