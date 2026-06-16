import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const where: any = { institutionId: session.sub };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { insuranceName: { contains: q, mode: "insensitive" } },
      { insuranceNumber: { contains: q, mode: "insensitive" } },
    ];
  }
  const patients = await prisma.institutionPatient.findMany({ where, orderBy: { name: "asc" } });
  await logAccess({ actorType: "INSTITUTION", actorId: session.sub, action: "VIEW", entity: "PATIENT", detail: `Liste (${patients.length})${q ? ` · Suche "${q}"` : ""}` });
  return NextResponse.json({ patients });
}

const schema = z.object({
  name: z.string().min(1).max(120),
  birthDate: z.string().max(20).optional().nullable(),
  gender: z.string().max(2).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().max(160).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  defaultPickupAddress: z.string().max(200).optional().nullable(),
  defaultPickupLat: z.number().optional().nullable(),
  defaultPickupLng: z.number().optional().nullable(),
  mobility: z.string().max(20).optional().nullable(),
  medicalEquipment: z.array(z.string().max(20)).max(10).optional().nullable(),
  payerType: z.string().max(20).optional().nullable(),
  insuranceName: z.string().max(120).optional().nullable(),
  insuranceNumber: z.string().max(60).optional().nullable(),
  kostentraegerNummer: z.string().max(40).optional().nullable(),
  befreiungUntil: z.string().max(20).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export async function POST(req: Request) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Bitte mindestens einen Namen angeben." }, { status: 400 });
  const d = parsed.data;

  const patient = await prisma.institutionPatient.create({
    data: {
      institutionId: session.sub,
      name: d.name,
      birthDate: d.birthDate ?? null,
      gender: d.gender ?? null,
      phone: d.phone ?? null,
      email: d.email ?? null,
      address: d.address ?? null,
      kostentraegerNummer: d.kostentraegerNummer ?? null,
      befreiungUntil: d.befreiungUntil ?? null,
      defaultPickupAddress: d.defaultPickupAddress ?? null,
      defaultPickupLat: d.defaultPickupLat ?? null,
      defaultPickupLng: d.defaultPickupLng ?? null,
      mobility: d.mobility ?? null,
      medicalEquipment: Array.isArray(d.medicalEquipment) && d.medicalEquipment.length ? d.medicalEquipment.join(",") : null,
      payerType: d.payerType ?? null,
      insuranceName: d.insuranceName ?? null,
      insuranceNumber: d.insuranceNumber ?? null,
      notes: d.notes ?? null,
    },
  });
  await logAccess({ actorType: "INSTITUTION", actorId: session.sub, action: "CREATE", entity: "PATIENT", entityId: patient.id, detail: patient.name });
  return NextResponse.json({ patient }, { status: 201 });
}
