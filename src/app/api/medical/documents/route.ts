import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, getSession } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";
import { documentValidity } from "@/lib/medical";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const KINDS = ["VERORDNUNG", "GENEHMIGUNG", "REZEPT", "BESCHEINIGUNG"] as const;
// ~6 MB Datei -> Base64 ~ 8.4 MB Zeichen. Großzügige Obergrenze.
const MAX_BASE64 = 9_000_000;
// Erlaubte Dateitypen: nur PDF + gängige Bilder. KEIN HTML/SVG (skriptfähig) –
// sonst stored XSS, wenn ein Admin das Dokument im Browser öffnet.
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"]);

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

// Upload eines Nachweises (Verordnung/Genehmigung ...). Zulässig für angemeldete
// Kunden/Einrichtungen ODER als Gast mit gültiger bookingId/recurringId
// (Capability). Owner-IDs (customerId/institutionId) werden AUS DER SESSION
// abgeleitet – niemals aus dem Body (sonst Fremd-Konten "vergiftbar").
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (ip) {
    const r = rateLimit(`upload:ip:${ip}`, 30, 10 * 60_000);
    if (!r.ok) return NextResponse.json({ error: "Zu viele Uploads. Bitte später erneut." }, { status: 429 });
  }

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

  // Dateityp hart whitelisten (gegen stored XSS durch HTML/SVG).
  if (!ALLOWED_MIME.has(d.mimeType.toLowerCase())) {
    return NextResponse.json({ error: "Nur PDF oder Bild (PNG/JPG/WEBP) erlaubt." }, { status: 400 });
  }

  const customer = getSession("customer");
  const institution = getSession("institution");

  // Anker: entweder eine existierende Buchung/Serie (Capability) ODER ein
  // angemeldetes Konto. Body-customerId/-institutionId werden ignoriert.
  if (!d.bookingId && !d.recurringId && !customer && !institution) {
    return NextResponse.json({ error: "Keine gültige Zuordnung (Buchung/Serie/angemeldetes Konto)." }, { status: 400 });
  }
  if (d.bookingId && !(await prisma.booking.findUnique({ where: { id: d.bookingId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Buchung nicht gefunden" }, { status: 404 });
  }
  if (d.recurringId && !(await prisma.recurringRide.findUnique({ where: { id: d.recurringId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Serie nicht gefunden" }, { status: 404 });
  }

  const uploadedByType = customer ? "CUSTOMER" : institution ? "INSTITUTION" : "GUEST";

  const doc = await prisma.medicalDocument.create({
    data: {
      kind: d.kind,
      fileName: d.fileName,
      mimeType: d.mimeType.toLowerCase(),
      dataBase64: d.dataBase64,
      validUntil: d.validUntil ?? null,
      bookingId: d.bookingId ?? null,
      recurringId: d.recurringId ?? null,
      customerId: customer?.sub ?? null,
      institutionId: institution?.sub ?? null,
      uploadedByType,
    },
    select: { id: true, kind: true, fileName: true, reviewStatus: true, createdAt: true },
  });

  await logAccess({
    actorType: customer ? "CUSTOMER" : institution ? "INSTITUTION" : "SYSTEM",
    actorId: customer?.sub ?? institution?.sub ?? null,
    action: "CREATE",
    entity: "MEDICAL_DOCUMENT",
    entityId: doc.id,
    detail: `${d.kind} hochgeladen`,
  });

  return NextResponse.json({ document: doc }, { status: 201 });
}

// Admin-Liste (ohne Dateiinhalt) – optional nach Status filterbar.
export async function GET(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  // Nur Dokumente von Buchungen der EIGENEN Firma (Mandanten-Isolation).
  const where: any = { booking: { companyId: session.companyId } };
  if (status && ["PENDING", "APPROVED", "REJECTED"].includes(status)) where.reviewStatus = status;
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
  await logAccess({ actorType: "ADMIN", companyId: session.companyId, actorId: session.sub, action: "VIEW", entity: "MEDICAL_DOCUMENT", detail: `Liste (${docs.length})` });
  return NextResponse.json({ documents: withValidity });
}
