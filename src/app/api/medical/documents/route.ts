import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, getSession } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";
import { documentValidity } from "@/lib/medical";

export const dynamic = "force-dynamic";

const KINDS = ["VERORDNUNG", "GENEHMIGUNG", "REZEPT", "BESCHEINIGUNG"] as const;
// ~6 MB Datei -> Base64 ~ 8.4 MB Zeichen. Großzügige Obergrenze.
const MAX_BASE64 = 9_000_000;

const schema = z.object({
  kind: z.enum(KINDS),
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  dataBase64: z.string().min(1).max(MAX_BASE64),
  validUntil: z.string().max(20).optional().nullable(),
  bookingId: z.string().optional().nullable(),
  recurringId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  institutionId: z.string().optional().nullable(),
});

// Upload eines Nachweises (Verordnung/Genehmigung ...). Erlaubt für Kunde,
// Einrichtung oder als Gast mit gültiger bookingId/recurringId (Capability).
export async function POST(req: Request) {
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datei zu groß oder ungültig (max. ~6 MB, PDF/Bild)." }, { status: 400 });
  }
  const d = parsed.data;

  if (!d.bookingId && !d.recurringId && !d.customerId && !d.institutionId) {
    return NextResponse.json({ error: "Keine Zuordnung (Buchung/Serie/Konto) angegeben." }, { status: 400 });
  }

  // Capability-Prüfung: referenzierte Buchung/Serie muss existieren.
  if (d.bookingId && !(await prisma.booking.findUnique({ where: { id: d.bookingId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Buchung nicht gefunden" }, { status: 404 });
  }
  if (d.recurringId && !(await prisma.recurringRide.findUnique({ where: { id: d.recurringId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Serie nicht gefunden" }, { status: 404 });
  }

  const customer = getSession("customer");
  const institution = getSession("admin"); // Einrichtung nutzt eigene Session (s. unten)
  const uploadedByType = customer ? "CUSTOMER" : d.institutionId ? "INSTITUTION" : "CUSTOMER";

  const doc = await prisma.medicalDocument.create({
    data: {
      kind: d.kind,
      fileName: d.fileName,
      mimeType: d.mimeType,
      dataBase64: d.dataBase64,
      validUntil: d.validUntil ?? null,
      bookingId: d.bookingId ?? null,
      recurringId: d.recurringId ?? null,
      customerId: d.customerId ?? customer?.sub ?? null,
      institutionId: d.institutionId ?? null,
      uploadedByType,
    },
    select: { id: true, kind: true, fileName: true, reviewStatus: true, createdAt: true },
  });

  await logAccess({
    actorType: customer ? "CUSTOMER" : "SYSTEM",
    actorId: customer?.sub ?? null,
    action: "CREATE",
    entity: "MEDICAL_DOCUMENT",
    entityId: doc.id,
    detail: `${d.kind} hochgeladen`,
  });
  void institution;

  return NextResponse.json({ document: doc }, { status: 201 });
}

// Admin-Liste (ohne Dateiinhalt) – optional nach Status filterbar.
export async function GET(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const where = status && ["PENDING", "APPROVED", "REJECTED"].includes(status) ? { reviewStatus: status } : {};
  const docs = await prisma.medicalDocument.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true, kind: true, fileName: true, mimeType: true, reviewStatus: true, reviewNote: true,
      reviewedAt: true, createdAt: true, validUntil: true, bookingId: true, recurringId: true, customerId: true, institutionId: true,
    },
  });
  const withValidity = docs.map((d) => ({ ...d, ...documentValidity(d.validUntil) }));
  await logAccess({ actorType: "ADMIN", actorId: session.sub, action: "VIEW", entity: "MEDICAL_DOCUMENT", detail: `Liste (${docs.length})` });
  return NextResponse.json({ documents: withValidity });
}
