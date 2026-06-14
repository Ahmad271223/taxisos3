import { prisma } from "@/lib/prisma";
import { DEFAULT_PRICING, type PricingConfig } from "@/lib/geo";
import { classMultiplier as defaultClassMultiplier, normalizeClass } from "@/lib/vehicleClasses";

// Laedt die Tarif-Konfiguration eines Unternehmens (per slug oder id).
export async function pricingForSlug(slug?: string | null): Promise<PricingConfig> {
  if (!slug) return DEFAULT_PRICING;
  const company = await prisma.company.findUnique({
    where: { slug },
    include: { pricing: true },
  });
  if (!company?.pricing) return DEFAULT_PRICING;
  return company.pricing as PricingConfig;
}

export async function pricingForCompanyId(companyId: string): Promise<PricingConfig> {
  const pricing = await prisma.pricing.findUnique({ where: { companyId } });
  return (pricing as PricingConfig) ?? DEFAULT_PRICING;
}

// --- Fahrzeugklassen-Preisfaktor (Phase 12 Marktplatz) ---------------------

export interface ClassFactor {
  multiplier: number;
  flatSurcharge: number;
  enabled: boolean;
}

function defaultFactor(classKey: string): ClassFactor {
  return { multiplier: defaultClassMultiplier(classKey), flatSurcharge: 0, enabled: true };
}

// Firmen-spezifischer Faktor je Klasse; Fallback = Plattform-Standard aus dem Katalog.
export async function classFactorForCompanyId(
  companyId: string | null | undefined,
  classKey: string,
): Promise<ClassFactor> {
  const key = normalizeClass(classKey);
  if (!companyId) return defaultFactor(key);
  const row = await prisma.vehicleClassPricing.findUnique({
    where: { companyId_classKey: { companyId, classKey: key } },
  });
  if (!row) return defaultFactor(key);
  return { multiplier: row.multiplier, flatSurcharge: row.flatSurcharge, enabled: row.enabled };
}

export async function classFactorForSlug(slug: string | null | undefined, classKey: string): Promise<ClassFactor> {
  const key = normalizeClass(classKey);
  if (!slug) return defaultFactor(key);
  const company = await prisma.company.findUnique({ where: { slug }, select: { id: true } });
  if (!company) return defaultFactor(key);
  return classFactorForCompanyId(company.id, key);
}

// Wendet einen Klassen-Faktor auf einen Preis an (multiplikativ + Fixaufschlag).
export function applyClassFactor(value: number, f: ClassFactor): number {
  return Math.round((value * f.multiplier + f.flatSurcharge) * 100) / 100;
}
