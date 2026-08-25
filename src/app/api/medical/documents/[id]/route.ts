import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";

export const dynamic = "force-dynamic";

// Dateiinhalt herunterladen (nur Admin). Liefert die rohen Bytes mit korrektem
// Content-Type, damit Verordnung/Genehmigung im Browser geöffnet werden kann.
// Nur PDF/Bilder dürfen inline angezeigt werden – alles andere wird als Download
// erzwungen und als octet-stream ausgeliefert (Schutz gegen stored XSS).
const SAFE_INLINE = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"]);

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const doc = await prisma.medicalDocument.findUnique({
    where: { id: params.id },
    include: { booking: { select: { companyId: true } } },
  });
  // Mandanten-Isolation: das Dokument muss zu einer Buchung der eigenen Firma
  // gehören. 404 statt 403, um die Existenz nicht preiszugeben.
  if (!doc || !doc.booking || doc.booking.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  await logAccess({ actorType: "ADMIN", companyId: session.companyId, actorId: session.sub, action: "DOWNLOAD", entity: "MEDICAL_DOCUMENT", entityId: doc.id, detail: doc.fileName });

  const mime = (doc.mimeType || "").toLowerCase();
  const safe = SAFE_INLINE.has(mime);
  const bytes = Buffer.from(doc.dataBase64, "base64");
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": safe ? mime : "application/octet-stream",
      "Content-Disposition": `${safe ? "inline" : "attachment"}; filename="${encodeURIComponent(doc.fileName)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

const reviewSchema = z.object({
  reviewStatus: z.enum(["APPROVED", "REJECTED", "PENDING"]),
  reviewNote: z.string().max(500).optional().nullable(),
});

// Prüf-Workflow: Dokument genehmigen/ablehnen (nur Admin).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const existing = await prisma.medicalDocument.findUnique({
    where: { id: params.id },
    select: { id: true, booking: { select: { companyId: true } } },
  });
  // Mandanten-Isolation: nur Dokumente der eigenen Firma dürfen geprüft werden.
  if (!existing || !existing.booking || existing.booking.companyId !== session.companyId) {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = reviewSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });

  const doc = await prisma.medicalDocument.update({
    where: { id: params.id },
    data: {
      reviewStatus: parsed.data.reviewStatus,
      reviewNote: parsed.data.reviewNote ?? null,
      reviewedAt: new Date(),
    },
    select: { id: true, kind: true, fileName: true, reviewStatus: true, reviewNote: true, reviewedAt: true },
  });

  await logAccess({
    actorType: "ADMIN",
    actorId: session.sub,
    action: parsed.data.reviewStatus === "APPROVED" ? "APPROVE" : parsed.data.reviewStatus === "REJECTED" ? "REJECT" : "VIEW",
    entity: "MEDICAL_DOCUMENT",
    entityId: doc.id,
    detail: parsed.data.reviewNote ?? null,
  });

  return NextResponse.json({ document: doc });
}
