// Plattform-Provision (Vermittlungsgebuehr).
// Großstadt (cityTier="BIG")  -> 7 %
// Klein-/laendlich (SMALL)    -> 5 %
// Keine Firma zugeordnet      -> 5 % (Default-Fallback)

export const COMMISSION_RATE_BIG = 0.07;
export const COMMISSION_RATE_SMALL = 0.05;

export function commissionRate(cityTier?: string | null): number {
  return cityTier === "BIG" ? COMMISSION_RATE_BIG : COMMISSION_RATE_SMALL;
}

export interface CommissionBreakdown {
  rate: number;
  platformFee: number;
  companyNet: number;
}

export function computeCommission(fare: number, cityTier?: string | null): CommissionBreakdown {
  const rate = commissionRate(cityTier);
  const platformFee = Math.round(fare * rate * 100) / 100;
  const companyNet = Math.round((fare - platformFee) * 100) / 100;
  return { rate, platformFee, companyNet };
}
