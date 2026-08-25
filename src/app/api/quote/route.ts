import { NextResponse } from "next/server";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug, classFactorForCompanyId, applyClassFactor } from "@/lib/pricing";
import { normalizeStops } from "@/lib/stops";
import { getPlatformRate, approxFare } from "@/lib/platformRate";
import { prisma } from "@/lib/prisma";
import { VEHICLE_CLASSES, normalizeClass, classFits, classMultiplier } from "@/lib/vehicleClasses";
import { fixedPriceRange } from "@/lib/fixedPrice";

// Spanne mit einem Festpreis zusammenführen (günstigste/teuerste Regel im System).
const lo = (a: number, b?: number | null) => (b == null ? a : Math.min(a, b));
const hi = (a: number, b?: number | null) => (b == null ? a : Math.max(a, b));

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

  // Festpreis-Engine: bei Direktfahrten (ohne Zwischenstopps) die passenden
  // Festpreis-Regeln aller Unternehmen laden und in die Spanne einrechnen.
  const pickupPt = { lat: Number(from.lat), lng: Number(from.lng) };
  const destPt = { lat: Number(to.lat), lng: Number(to.lng) };
  const hasStops = normalizeStops(stops).length > 0;
  // Steht die Firma bereits fest (Buchung ueber /c/<slug>), duerfen NUR
  // deren Regeln einfliessen – sonst wuerde der Preis fremder Unternehmen
  // die Spanne verschieben und deren Kalkulation nach aussen sichtbar.
  // Ohne Firma ist die plattformweite Sicht dagegen richtig: jede Firma
  // koennte die Fahrt uebernehmen.
  const fixedRules = hasStops
    ? []
    : await prisma.fixedPriceRule.findMany({ where: { active: true, ...(companyId ? { companyId } : {}) } });

  // Preisvergleich über alle Klassen (Phase 12 Fahrzeug-Marktplatz).
  const classes = await Promise.all(
    VEHICLE_CLASSES.map(async (c) => {
      const factor = companyId
        ? await classFactorForCompanyId(companyId, c.key)
        : { multiplier: classMultiplier(c.key), flatSurcharge: 0, enabled: true };
      const cFixed = fixedPriceRange(fixedRules, pickupPt, destPt, c.key);
      return {
        key: c.key,
        label: c.label,
        short: c.short,
        icon: c.icon,
        seats: c.seats,
        luggage: c.luggage,
        desc: c.desc,
        price: applyClassFactor(baseApprox, factor),
        priceMin: lo(applyClassFactor(estimate.priceMin, factor), cFixed?.min),
        priceMax: hi(applyClassFactor(estimate.priceMax, factor), cFixed?.max),
        fixedPrice: cFixed?.min ?? null,
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

  const selFixed = fixedPriceRange(fixedRules, pickupPt, destPt, selected);

  return NextResponse.json({
    ...estimate,
    priceMin: lo(applyClassFactor(estimate.priceMin, selFactor), selFixed?.min),
    priceMax: hi(applyClassFactor(estimate.priceMax, selFactor), selFixed?.max),
    priceApprox: applyClassFactor(baseApprox, selFactor),
    fixedPrice: selFixed?.min ?? null,
    approxPerKm: rate.avgPerKm,
    vehicleClass: selected,
    classes: classes.filter((c) => c.enabled),
  });
}
