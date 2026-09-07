import { NextResponse } from "next/server";
import { einrichtungAktiv } from "@/lib/kontoAktiv";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  // Eine Sperre muss SOFORT wirken, nicht erst wenn der Ausweis nach sieben
  // Tagen ablaeuft - hier haengen Patientenakten dran.
  if (!(await einrichtungAktiv(session.sub))) {
    return NextResponse.json(
      { error: "Ihr Zugang ist derzeit gesperrt. Bitte wenden Sie sich an die Zentrale.", code: "INSTITUTION_INACTIVE" },
      { status: 403 },
    );
  }
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
  // Ohne Obergrenze holte jede Anfrage den KOMPLETTEN Patientenbestand -
  // bei einer grossen Klinik zehntausende Datensaetze mit Namen,
  // Geburtsdaten und Versicherungsnummern. Das ist nicht nur langsam,
  // sondern auch ein unnoetig grosser Datenabzug je Klick.
  const patients = await prisma.institutionPatient.findMany({
    where,
    orderBy: { name: "asc" },
    take: 200,
  });
  // Der Suchbegriff wird BEWUSST nicht mitgeschrieben: gesucht wird unter
  // anderem nach Versicherungsnummer und Telefonnummer. Diese Werte im
  // Zugriffsprotokoll zu wiederholen wuerde dieselben sensiblen Daten ein
  // zweites Mal speichern - das Gegenteil von Datenminimierung.
  await logAccess({ actorType: "INSTITUTION", actorId: session.sub, action: "VIEW", entity: "PATIENT", detail: `Liste (${patients.length})${q ? " · mit Suchbegriff" : ""}` });
  return NextResponse.json({ patients });
}

const schema = z.object({
  name: z.string().min(1).max(120),
  // Freitext wie "morgen" war bisher ein gueltiges Geburtsdatum.
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte JJJJ-MM-TT").optional().nullable().or(z.literal("")),
  gender: z.string().max(2).optional().nullable(),
  phone: z.string().max(40).optional().nullable(),
  // Vorher galt jede Zeichenkette als E-Mail - auch "nicht vorhanden".
  email: z.string().email().max(160).optional().nullable().or(z.literal("")),
  address: z.string().max(200).optional().nullable(),
  defaultPickupAddress: z.string().max(200).optional().nullable(),
  defaultPickupLat: z.number().finite().min(-90).max(90).optional().nullable(),
  defaultPickupLng: z.number().finite().min(-180).max(180).optional().nullable(),
  mobility: z.string().max(20).optional().nullable(),
  medicalEquipment: z.array(z.string().max(20)).max(10).optional().nullable(),
  payerType: z.string().max(20).optional().nullable(),
  insuranceName: z.string().max(120).optional().nullable(),
  insuranceNumber: z.string().max(60).optional().nullable(),
  kostentraegerNummer: z.string().max(40).optional().nullable(),
  befreiungUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte JJJJ-MM-TT").optional().nullable().or(z.literal("")),
  notes: z.string().max(500).optional().nullable(),
});

export async function POST(req: Request) {
  const session = requireRole("INSTITUTION");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  // Eine Sperre muss SOFORT wirken, nicht erst wenn der Ausweis nach sieben
  // Tagen ablaeuft - hier haengen Patientenakten dran.
  if (!(await einrichtungAktiv(session.sub))) {
    return NextResponse.json(
      { error: "Ihr Zugang ist derzeit gesperrt. Bitte wenden Sie sich an die Zentrale.", code: "INSTITUTION_INACTIVE" },
      { status: 403 },
    );
  }
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
