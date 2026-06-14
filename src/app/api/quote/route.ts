import { NextResponse } from "next/server";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug, classFactorForCompanyId, applyClassFactor } from "@/lib/pricing";
import { normalizeStops } from "@/lib/stops";
import { getPlatformRate, approxFare } from "@/lib/platformRate";
import { prisma } from "@/lib/prisma";
import { VEHICLE_CLASSES, normalizeClass, classFits, classMultiplier } from "@/lib/vehicleClasses";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const { from, to, stops, company, passengers, luggage } = body ?? {};
  if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) {
    return NextResponse.json({ error: "Start- und Zielkoordinaten erforderlich" }, { status: 400 });
  }
  const pricing = await pricingForSlug(company);
  // Gesamtpreis ueber Abholung -> Zwischenstopps -> Ziel (Mehrziel, Phase 2e).
  const points = [
    { lat: Number(from.lat), lng: Number(from.lng) },
    ...normalizeStops(stops).map((s) => ({ lat: s.lat, lng: s.lng })),
    { lat: Number(to.lat), lng: Number(to.lng) },
  ];
  const estimate = await estimatePriceViaWith(points, pricing);

  // „ca."-Vorabpreis aus dem täglichen Plattform-Durchschnitt (vor Fahrer-Annahme).
  const rate = await getPlatformRate();
  const baseApprox = approxFare(rate, estimate.distanceMeters, estimate.durationSeconds);

  // Optional: konkrete Firma -> Firmen-Faktoren je Klasse, sonst Plattform-Standard.
  const companyId = company
    ? (await prisma.company.findUnique({ where: { slug: company }, select: { id: true } }))?.id ?? null
    : null;

  // Wie viele freie Fahrer gibt es je Klasse? (informativer Marktplatz-Hinweis)
  const availByClass = new Map<string, number>();
  try {
    const grouped = await prisma.driver.groupBy({
      by: ["vehicleClass"],
      where: { active: true, status: "FREI", ...(companyId ? { companyId } : {}) },
      _count: { _all: true },
    });
    for (const g of grouped) availByClass.set(g.vehicleClass, g._count._all);
  } catch {
    /* Verfügbarkeit ist optional */
  }

  const reqLoad = {
    passengers: Number.isFinite(passengers) ? Number(passengers) : undefined,
    luggage: Number.isFinite(luggage) ? Number(luggage) : undefined,
  };

  // Preisvergleich über alle Klassen (Phase 12 Fahrzeug-Marktplatz).
  const classes = await Promise.all(
    VEHICLE_CLASSES.map(async (c) => {
      const factor = companyId
        ? await classFactorForCompanyId(companyId, c.key)
        : { multiplier: classMultiplier(c.key), flatSurcharge: 0, enabled: true };
      return {
        key: c.key,
        label: c.label,
        short: c.short,
        icon: c.icon,
        seats: c.seats,
        luggage: c.luggage,
        desc: c.desc,
        price: applyClassFactor(baseApprox, factor),
        priceMin: applyClassFactor(estimate.priceMin, factor),
        priceMax: applyClassFactor(estimate.priceMax, factor),
        enabled: factor.enabled,
        fits: classFits(c, reqLoad),
        available: availByClass.get(c.key) ?? 0,
      };
    }),
  );

  // Gewählte Klasse -> skalierter Hauptpreis (für die bestehende Anzeige).
  const selected = normalizeClass(body?.vehicleClass);
  const selFactor = companyId
    ? await classFactorForCompanyId(companyId, selected)
    : { multiplier: classMultiplier(selected), flatSurcharge: 0, enabled: true };

  return NextResponse.json({
    ...estimate,
    priceMin: applyClassFactor(estimate.priceMin, selFactor),
    priceMax: applyClassFactor(estimate.priceMax, selFactor),
    priceApprox: applyClassFactor(baseApprox, selFactor),
    approxPerKm: rate.avgPerKm,
    vehicleClass: selected,
    classes: classes.filter((c) => c.enabled),
  });
}
