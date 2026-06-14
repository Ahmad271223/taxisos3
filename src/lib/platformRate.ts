// Plattform-Durchschnittstarif: täglich (02:00) aus den Tarifen ALLER
// registrierten Firmen berechnet und 24 h als „ca."-Vorabpreis genutzt
// (bevor ein Fahrer/Firmentarif feststeht). Nach Fahrer-Annahme gilt der
// exakte Firmentarif (priceExact), am Fahrtende wird dieser abgebucht.

import { prisma } from "@/lib/prisma";
import { DEFAULT_PRICING } from "@/lib/geo";

export interface PlatformRateValues {
  avgBasePrice: number;
  avgPerKm: number;
  avgPerMinute: number;
  companyCount: number;
  computedAt: string;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Durchschnitt über alle Firmen (ohne _super). Firmen ohne Tarif -> Standard.
export async function computePlatformRate(): Promise<PlatformRateValues> {
  const companies = await prisma.company.findMany({
    where: { slug: { not: "_super" } },
    include: { pricing: true },
  });

  const tariffs = companies.map((c) => c.pricing ?? DEFAULT_PRICING);
  const n = tariffs.length;

  const avgBasePrice = n ? r2(tariffs.reduce((s, p) => s + p.basePrice, 0) / n) : DEFAULT_PRICING.basePrice;
  const avgPerKm = n ? r2(tariffs.reduce((s, p) => s + p.perKmDay, 0) / n) : DEFAULT_PRICING.perKmDay;
  const avgPerMinute = n ? r2(tariffs.reduce((s, p) => s + p.perMinute, 0) / n) : DEFAULT_PRICING.perMinute;

  const row = await prisma.platformRate.upsert({
    where: { id: "current" },
    update: { avgBasePrice, avgPerKm, avgPerMinute, companyCount: n, computedAt: new Date() },
    create: { id: "current", avgBasePrice, avgPerKm, avgPerMinute, companyCount: n },
  });

  return {
    avgBasePrice: row.avgBasePrice,
    avgPerKm: row.avgPerKm,
    avgPerMinute: row.avgPerMinute,
    companyCount: row.companyCount,
    computedAt: row.computedAt.toISOString(),
  };
}

// Aktuellen Tarif lesen; fehlt er (frischer Start) -> einmalig berechnen.
export async function getPlatformRate(): Promise<PlatformRateValues> {
  const row = await prisma.platformRate.findUnique({ where: { id: "current" } });
  if (!row) return computePlatformRate();
  return {
    avgBasePrice: row.avgBasePrice,
    avgPerKm: row.avgPerKm,
    avgPerMinute: row.avgPerMinute,
    companyCount: row.companyCount,
    computedAt: row.computedAt.toISOString(),
  };
}

// „ca."-Fahrpreis = Ø-Grundpreis + Ø-km-Preis × km (+ Ø-Minutenpreis × min).
export function approxFare(rate: PlatformRateValues, distanceMeters: number, durationSeconds: number): number {
  const km = (distanceMeters ?? 0) / 1000;
  const min = (durationSeconds ?? 0) / 60;
  return r2(rate.avgBasePrice + km * rate.avgPerKm + min * rate.avgPerMinute);
}
