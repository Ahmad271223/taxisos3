// Unternehmens-Abo (Monatstarife). Das Abo ist die EINZIGE Einnahmequelle der
// Plattform – pro Fahrt wird KEINE Provision einbehalten (siehe lib/commission.ts).
//
// Der gebuchte Tarif bestimmt, wie viele Fahrer ein Unternehmen anlegen darf.

export interface Plan {
  id: string;          // P5 | P10 | P15 | P20
  name: string;        // Anzeigename
  maxDrivers: number;  // erlaubte Fahrer
  monthlyPrice: number; // EUR / Monat (netto ausgewiesen wie bisher)
}

export const PLANS: Plan[] = [
  { id: "P5", name: "Bis 5 Fahrer", maxDrivers: 5, monthlyPrice: 100 },
  { id: "P10", name: "Bis 10 Fahrer", maxDrivers: 10, monthlyPrice: 190 },
  { id: "P15", name: "Bis 15 Fahrer", maxDrivers: 15, monthlyPrice: 235 },
  { id: "P20", name: "Bis 20 Fahrer", maxDrivers: 20, monthlyPrice: 260 },
];

export const DEFAULT_PLAN_ID = "P5";

export function getPlan(planId?: string | null): Plan {
  return PLANS.find((p) => p.id === planId) ?? PLANS[0];
}

export function maxDriversFor(planId?: string | null): number {
  return getPlan(planId).maxDrivers;
}

export function monthlyPriceFor(planId?: string | null): number {
  return getPlan(planId).monthlyPrice;
}

// Kleinster Tarif, der die gewuenschte Fahrerzahl abdeckt (fuer Upgrade-Hinweise).
export function planForDriverCount(count: number): Plan | null {
  return PLANS.find((p) => p.maxDrivers >= count) ?? null;
}

// Darf noch ein weiterer Fahrer angelegt werden?
export function canAddDriver(planId: string | null | undefined, currentDrivers: number): {
  allowed: boolean;
  plan: Plan;
  suggestion: Plan | null;
} {
  const plan = getPlan(planId);
  const allowed = currentDrivers < plan.maxDrivers;
  return {
    allowed,
    plan,
    suggestion: allowed ? null : planForDriverCount(currentDrivers + 1),
  };
}
