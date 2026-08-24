import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import { driverAdmin } from "@/server/serialize";
import { normalizeClass } from "@/lib/vehicleClasses";
import { canAddDriver, getPlan } from "@/lib/plans";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const [drivers, company] = await Promise.all([
    prisma.driver.findMany({ where: { companyId: session.companyId }, orderBy: { name: "asc" } }),
    prisma.company.findUnique({ where: { id: session.companyId }, select: { plan: true } }),
  ]);
  const plan = getPlan(company?.plan);
  return NextResponse.json({
    drivers: drivers.map((d) => driverAdmin(d)),
    // Kontingent aus dem gebuchten Abo – das UI blendet damit den
    // "Fahrer anlegen"-Button aus, sobald das Limit erreicht ist.
    plan: { id: plan.id, name: plan.name, maxDrivers: plan.maxDrivers, monthlyPrice: plan.monthlyPrice },
    driverCount: drivers.length,
    canAddDriver: drivers.length < plan.maxDrivers,
  });
}

const createSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3),
  password: z.string().min(4),
  phone: z.string().optional().nullable(),
  vehicleModel: z.string().optional().nullable(),
  vehiclePlate: z.string().optional().nullable(),
  vehicleColor: z.string().optional().nullable(),
  vehicleSeats: z.number().int().min(1).max(9).optional(),
  vehicleClass: z.string().optional().nullable(),
  medicalAllowed: z.boolean().optional(),
  hasRamp: z.boolean().optional(),
  hasStretcher: z.boolean().optional(),
  pScheinUntil: z.string().max(20).optional().nullable(),
  wheelchairTrained: z.boolean().optional(),
  qualifications: z.string().max(300).optional().nullable(),
  licenseUntil: z.string().max(20).optional().nullable(),
  concessionUntil: z.string().max(20).optional().nullable(),
  insuranceUntil: z.string().max(20).optional().nullable(),
  tuevUntil: z.string().max(20).optional().nullable(),
});

export async function POST(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte Name, Benutzername (min. 3) und Passwort (min. 4) angeben." }, { status: 400 });
  }
  const d = parsed.data;

  if (await prisma.driver.findUnique({ where: { username: d.username } })) {
    return NextResponse.json({ error: "Benutzername ist bereits vergeben." }, { status: 409 });
  }

  // Fahrer-Kontingent des gebuchten Abos durchsetzen.
  const company = await prisma.company.findUnique({
    where: { id: session.companyId },
    select: { plan: true, subscriptionStatus: true },
  });

  // Ohne laufendes Abo koennen keine weiteren Fahrer angelegt werden.
  // Die Testphase (TRIAL) ist bewusst erlaubt, damit neue Firmen sofort starten.
  if (company && ["UEBERFAELLIG", "GEKUENDIGT"].includes(company.subscriptionStatus)) {
    return NextResponse.json(
      {
        error:
          company.subscriptionStatus === "UEBERFAELLIG"
            ? "Die letzte Abo-Zahlung ist fehlgeschlagen. Bitte aktualisieren Sie Ihr Zahlungsmittel, um weitere Fahrer anzulegen."
            : "Ihr Abo ist gekündigt. Bitte buchen Sie einen Tarif, um weitere Fahrer anzulegen.",
        code: "SUBSCRIPTION_INACTIVE",
        subscriptionStatus: company.subscriptionStatus,
      },
      { status: 402 },
    );
  }
  const currentDrivers = await prisma.driver.count({ where: { companyId: session.companyId } });
  const gate = canAddDriver(company?.plan, currentDrivers);
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error: `Ihr Tarif "${gate.plan.name}" erlaubt maximal ${gate.plan.maxDrivers} Fahrer. ${
          gate.suggestion
            ? `Für mehr Fahrer bitte auf "${gate.suggestion.name}" (${gate.suggestion.monthlyPrice} €/Monat) wechseln.`
            : "Bitte kontaktieren Sie uns für ein größeres Kontingent."
        }`,
        code: "PLAN_LIMIT_REACHED",
        plan: { id: gate.plan.id, maxDrivers: gate.plan.maxDrivers },
        driverCount: currentDrivers,
        suggestion: gate.suggestion,
      },
      { status: 402 },
    );
  }

  const driver = await prisma.driver.create({
    data: {
      companyId: session.companyId,
      name: d.name,
      username: d.username,
      passwordHash: await hashPassword(d.password),
      phone: d.phone ?? null,
      vehicleModel: d.vehicleModel ?? null,
      vehiclePlate: d.vehiclePlate ?? null,
      vehicleColor: d.vehicleColor ?? null,
      vehicleSeats: d.vehicleSeats ?? 4,
      vehicleClass: normalizeClass(d.vehicleClass),
      medicalAllowed: d.medicalAllowed ?? false,
      hasRamp: d.hasRamp ?? false,
      hasStretcher: d.hasStretcher ?? false,
      pScheinUntil: d.pScheinUntil ?? null,
      wheelchairTrained: d.wheelchairTrained ?? false,
      qualifications: d.qualifications ?? null,
      licenseUntil: d.licenseUntil ?? null,
      concessionUntil: d.concessionUntil ?? null,
      insuranceUntil: d.insuranceUntil ?? null,
      tuevUntil: d.tuevUntil ?? null,
      status: "OFFLINE",
    },
  });
  return NextResponse.json({ driver: driverAdmin(driver) }, { status: 201 });
}
