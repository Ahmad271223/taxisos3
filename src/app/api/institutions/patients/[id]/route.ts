import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";
import { bookingDTO } from "@/server/serialize";

export const dynamic = "force-dynamic";

// Patientenakte: Stammdaten + Fahrtenhistorie + Dokumente (DSGVO-protokolliert).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const patient = await prisma.institutionPatient.findUnique({ where: { id: params.id } });
  if (!patient || patient.institutionId !== session.sub) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const bookings = await prisma.booking.findMany({
    where: { institutionPatientId: patient.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { driver: true },
  });
  const bookingIds = bookings.map((b) => b.id);
  const documents = bookingIds.length
    ? await prisma.medicalDocument.findMany({
        where: { bookingId: { in: bookingIds } },
        orderBy: { createdAt: "desc" },
        select: { id: true, kind: true, fileName: true, reviewStatus: true, createdAt: true, bookingId: true },
      })
    : [];

  await logAccess({ actorType: "INSTITUTION", actorId: session.sub, action: "VIEW", entity: "PATIENT", entityId: patient.id, detail: `Akte ${patient.name}` });

  return NextResponse.json({
    patient,
    rides: bookings.map((b) => bookingDTO(b)),
    documents,
    stats: {
      totalRides: bookings.length,
      completed: bookings.filter((b) => b.status === "ABGESCHLOSSEN").length,
    },
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  birthDate: z.string().max(20).optional().nullable(),
  gender: z.string().max(2).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  email: z.string().max(160).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  mobility: z.string().max(20).optional().nullable(),
  payerType: z.string().max(20).optional().nullable(),
  insuranceName: z.string().max(120).optional().nullable(),
  insuranceNumber: z.string().max(60).optional().nullable(),
  kostentraegerNummer: z.string().max(40).optional().nullable(),
  befreiungUntil: z.string().max(20).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

// Stammdaten der Akte aktualisieren.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const existing = await prisma.institutionPatient.findUnique({ where: { id: params.id }, select: { institutionId: true } });
  if (!existing || existing.institutionId !== session.sub) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  const patient = await prisma.institutionPatient.update({ where: { id: params.id }, data: parsed.data });
  await logAccess({ actorType: "INSTITUTION", actorId: session.sub, action: "CREATE", entity: "PATIENT", entityId: patient.id, detail: `Akte aktualisiert ${patient.name}` });
  return NextResponse.json({ patient });
}
