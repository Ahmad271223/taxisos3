// Event-Promo-Codes (Mass Mobility): Gültigkeitsprüfung + Rabattberechnung.

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PromoLike {
  active: boolean;
  discountType: string; // PERCENT | FIXED
  discountValue: number;
  validUntil?: string | null;
  maxUses?: number | null;
  usedCount?: number | null;
}

export function promoUsable(promo: PromoLike | null | undefined): boolean {
  if (!promo || !promo.active) return false;
  if (promo.maxUses != null && (promo.usedCount ?? 0) >= promo.maxUses) return false;
  if (promo.validUntil) {
    const d = new Date(promo.validUntil);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      if (Date.now() > d.getTime()) return false;
    }
  }
  return true;
}

// Rabattbetrag (EUR) für einen Basispreis. PERCENT 0–100, FIXED gedeckelt.
export function promoDiscountAmount(promo: PromoLike, baseAmount: number): number {
  const base = Math.max(0, baseAmount || 0);
  if (promo.discountType === "FIXED") return r2(Math.min(base, Math.max(0, promo.discountValue)));
  const pct = Math.max(0, Math.min(100, promo.discountValue));
  return r2((base * pct) / 100);
}

export function promoLabelText(promo: PromoLike): string {
  return promo.discountType === "FIXED" ? `${promo.discountValue} € Rabatt` : `${promo.discountValue} % Rabatt`;
}
