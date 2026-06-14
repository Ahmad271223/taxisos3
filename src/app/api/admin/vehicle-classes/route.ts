import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { VEHICLE_CLASSES, classMultiplier, normalizeClass, isValidClass } from "@/lib/vehicleClasses";

export const dynamic = "force-dynamic";

// Liefert je Fahrzeugklasse die Firmen-Konfiguration (enabled/multiplier/surcharge),
// gefüllt mit Plattform-Standardwerten, wo die Firma noch nichts gesetzt hat.
export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const rows = await prisma.vehicleClassPricing.findMany({ where: { companyId: session.companyId } });
  const byKey = new Map(rows.map((r) => [r.classKey, r]));

  const classes = VEHICLE_CLASSES.map((c) => {
    const row = byKey.get(c.key);
    return {
      key: c.key,
      label: c.label,
      icon: c.icon,
      seats: c.seats,
      luggage: c.luggage,
      desc: c.desc,
      defaultMultiplier: c.multiplier,
      enabled: row?.enabled ?? true,
      multiplier: row?.multiplier ?? c.multiplier,
      flatSurcharge: row?.flatSurcharge ?? 0,
    };
  });
  return NextResponse.json({ classes });
}

const schema = z.object({
  classes: z
    .array(
      z.object({
        key: z.string(),
        enabled: z.boolean().optional(),
        multiplier: z.number().min(0.1).max(10).optional(),
        flatSurcharge: z.number().min(0).max(1000).optional(),
      }),
    )
    .max(VEHICLE_CLASSES.length),
});

// Speichert die Klassen-Preise der Firma (Upsert je Klasse).
export async function PUT(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Klassendaten" }, { status: 400 });
  }

  for (const c of parsed.data.classes) {
    if (!isValidClass(c.key)) continue;
    const key = normalizeClass(c.key);
    await prisma.vehicleClassPricing.upsert({
      where: { companyId_classKey: { companyId: session.companyId, classKey: key } },
      update: {
        enabled: c.enabled ?? true,
        multiplier: c.multiplier ?? classMultiplier(key),
        flatSurcharge: c.flatSurcharge ?? 0,
      },
      create: {
        companyId: session.companyId,
        classKey: key,
        enabled: c.enabled ?? true,
        multiplier: c.multiplier ?? classMultiplier(key),
        flatSurcharge: c.flatSurcharge ?? 0,
      },
    });
  }

  const rows = await prisma.vehicleClassPricing.findMany({ where: { companyId: session.companyId } });
  return NextResponse.json({ ok: true, count: rows.length });
}
