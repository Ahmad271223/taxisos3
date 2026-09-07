import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole, getSession } from "@/lib/session";
import { logAccess } from "@/lib/accessLog";
import { documentValidity } from "@/lib/medical";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Die ersten Bytes echter Dateien ("magic bytes").
const KENNUNG: Record<string, number[][]> = {
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]], // %PDF
  "image/png": [[0x89, 0x50, 0x4e, 0x47]],
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]], // RIFF....WEBP
};

function pruefeInhalt(base64: string, mime: string): { ok: boolean; grund?: string } {
  // Node nimmt bei Base64 fast alles an und wirft Unbrauchbares still weg.
  // Deshalb zuerst streng pruefen, was da ueberhaupt ankommt.
  const sauber = base64.replace(/^data:[^,]*,/, "").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(sauber) || sauber.length % 4 !== 0) {
    return { ok: false, grund: "Die Datei konnte nicht gelesen werden." };
  }
  let kopf: Buffer;
  try {
    kopf = Buffer.from(sauber.slice(0, 64), "base64");
  } catch {
    return { ok: false, grund: "Die Datei konnte nicht gelesen werden." };
  }
  const erwartet = KENNUNG[mime];
  if (!erwartet) return { ok: true };
  const passt = erwartet.some((sig) => sig.every((b, i) => kopf[i] === b));
  if (!passt) {
    return { ok: false, grund: "Die Datei passt nicht zum angegebenen Format (PDF/PNG/JPG/WEBP)." };
  }
  return { ok: true };
}

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
  // Fuer Gaeste ohne Konto: der Verfolgungs-Token aus der Bestaetigungs-SMS.
  trackingToken: z.string().optional().nullable(),
  recurringId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  institutionId: z.string().optional().nullable(),
});

// Upload eines Nachweises (Verordnung, Genehmigung ...).
//
// SICHERHEIT (08.09.2026): Frueher galt eine beliebige EXISTIERENDE
// Buchungs- oder Serien-Kennung als Berechtigung - geprueft wurde nur, ob der
// Datensatz existiert. Damit konnte jeder, der eine fremde Kennung kannte,
// eine aerztliche Verordnung an die Fahrt eines fremden Menschen haengen. Die
// Kennungen tauchen in Belegnummern und Dateinamen auf; genau deshalb waren
// sie bei den Buchungsrouten laengst entwertet worden. Hier lebte das alte
// Modell weiter.
//
// Jetzt gilt:
//   - Angemeldeter Kunde:     die Buchung/Serie muss IHM gehoeren.
//   - Angemeldete Einrichtung: die Buchung/Serie muss IHR gehoeren.
//   - Gast ohne Konto:         nur ueber den Verfolgungs-Token, nie ueber die
//                              interne Kennung. Serien gibt es fuer Gaeste nicht.
// Owner-IDs (customerId/institutionId) stammen weiterhin ausschliesslich aus
// der Sitzung, niemals aus dem Body.
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

  // Der Typ kam bisher ALLEIN aus der Behauptung des Absenders. Eine beliebige
  // Datei liess sich als "application/pdf" ablegen. Deshalb zusaetzlich in die
  // Datei selbst schauen: die ersten Bytes verraten das echte Format.
  const inhalt = pruefeInhalt(d.dataBase64, d.mimeType.toLowerCase());
  if (!inhalt.ok) {
    return NextResponse.json({ error: inhalt.grund }, { status: 400 });
  }

  const customer = getSession("customer");
  const institution = getSession("institution");

  if (!d.bookingId && !d.trackingToken && !d.recurringId && !customer && !institution) {
    return NextResponse.json({ error: "Keine gültige Zuordnung (Buchung/Serie/angemeldetes Konto)." }, { status: 400 });
  }

  // ---- Buchung: Zugehoerigkeit pruefen, nicht blosse Existenz --------------
  let bookingId: string | null = null;
  if (d.trackingToken) {
    // Gastweg: der Token ist die Berechtigung.
    const b = await prisma.booking.findFirst({
      where: { trackingToken: d.trackingToken },
      select: { id: true },
    });
    if (!b) return NextResponse.json({ error: "Buchung nicht gefunden" }, { status: 404 });
    bookingId = b.id;
  } else if (d.bookingId) {
    if (!customer && !institution) {
      // Die interne Kennung allein ist KEINE Berechtigung mehr.
      return NextResponse.json(
        { error: "Bitte melden Sie sich an oder nutzen Sie den Link aus Ihrer Bestätigung." },
        { status: 403 },
      );
    }
    const b = await prisma.booking.findFirst({
      where: {
        id: d.bookingId,
        ...(customer ? { customerId: customer.sub } : { institutionId: institution!.sub }),
      },
      select: { id: true },
    });
    if (!b) return NextResponse.json({ error: "Buchung nicht gefunden" }, { status: 404 });
    bookingId = b.id;
  }

  // ---- Serie: nur mit Konto und nur die eigene -----------------------------
  let recurringId: string | null = null;
  if (d.recurringId) {
    if (!customer && !institution) {
      return NextResponse.json({ error: "Für Serienfahrten bitte anmelden." }, { status: 403 });
    }
    const r = await prisma.recurringRide.findFirst({
      where: {
        id: d.recurringId,
        ...(customer ? { customerId: customer.sub } : { institutionId: institution!.sub }),
      },
      select: { id: true },
    });
    if (!r) return NextResponse.json({ error: "Serie nicht gefunden" }, { status: 404 });
    recurringId = r.id;
  }

  const uploadedByType = customer ? "CUSTOMER" : institution ? "INSTITUTION" : "GUEST";

  const doc = await prisma.medicalDocument.create({
    data: {
      kind: d.kind,
      fileName: d.fileName,
      mimeType: d.mimeType.toLowerCase(),
      dataBase64: d.dataBase64,
      validUntil: d.validUntil ?? null,
      bookingId,
      recurringId,
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
