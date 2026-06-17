import { prisma } from "@/lib/prisma";

// Plattform-Leitplanken (Super-Admin), Singleton mit fester id="default".
// Kurz gecacht, da im Dispatch-Hotpath gelesen.

export interface PlatformConfigData {
  minBaseFare: number;
  minPerKm: number;
  insuranceBaseFare: number;
  insurancePerKm: number;
}

const DEFAULTS: PlatformConfigData = { minBaseFare: 0, minPerKm: 0, insuranceBaseFare: 0, insurancePerKm: 0 };

let cache: { at: number; data: PlatformConfigData } | null = null;
const TTL_MS = 30_000;

export async function getPlatformConfig(): Promise<PlatformConfigData> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const row = await prisma.platformConfig.findUnique({ where: { id: "default" } });
    const data: PlatformConfigData = row
      ? {
          minBaseFare: row.minBaseFare,
          minPerKm: row.minPerKm,
          insuranceBaseFare: row.insuranceBaseFare,
          insurancePerKm: row.insurancePerKm,
        }
      : DEFAULTS;
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return DEFAULTS;
  }
}

export async function setPlatformConfig(d: PlatformConfigData): Promise<PlatformConfigData> {
  const row = await prisma.platformConfig.upsert({
    where: { id: "default" },
    update: d,
    create: { id: "default", ...d },
  });
  cache = null; // invalidieren
  return {
    minBaseFare: row.minBaseFare,
    minPerKm: row.minPerKm,
    insuranceBaseFare: row.insuranceBaseFare,
    insurancePerKm: row.insurancePerKm,
  };
}
