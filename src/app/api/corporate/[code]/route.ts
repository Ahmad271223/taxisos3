import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCorporateCode, corporateAvailable, corporateRemaining, corporateReasonText } from "@/lib/corporate";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Öffentlich: löst einen Firmen-Mobilitäts-Code auf (für die QR-Landingpage und
// die Buchungs-Validierung).
//
// DATENSPARSAMKEIT (07.09.2026): Diese Antwort verriet frueher das Restbudget,
// die Zahl der verbleibenden Fahrten und das Limit je Fahrt. Ein Code hat
// Geldwert und wandert per QR-Aufsteller durch die Welt; wer einen findet,
// sollte daraus nicht die Finanzlage des ausstellenden Unternehmens ablesen
// koennen ("Restbudget 3.850 EUR"). Zurueck kommt jetzt nur noch, was die
// Buchungsseite wirklich braucht: gilt der Code, wie heisst die Firma, und
// ist ueberhaupt noch etwas frei.
export async function GET(req: Request, { params }: { params: { code: string } }) {
  // Ohne Bremse liessen sich Codes durchprobieren, bis einer passt.
  const ip = clientIp(req);
  if (ip && !rateLimit(`corporate-code:${ip}`, 20, 10 * 60_000).ok) {
    return NextResponse.json({ valid: false, reason: "Zu viele Versuche. Bitte später erneut." }, { status: 429 });
  }
  const code = normalizeCorporateCode(params.code ?? "");
  if (!code) return NextResponse.json({ valid: false, reason: "Ungültiger Code." }, { status: 400 });

  const cc = await prisma.corporateCode.findUnique({
    where: { code },
    include: { eventHost: { select: { name: true } } },
  });
  if (!cc) return NextResponse.json({ valid: false, reason: "Dieser Firmen-Code ist unbekannt." }, { status: 404 });

  const avail = corporateAvailable(cc);
  const remaining = corporateRemaining(cc);
  if (!avail.ok) {
    return NextResponse.json({
      valid: false,
      reason: corporateReasonText(avail.reason),
      company: cc.eventHost.name,
      label: cc.label,
    });
  }
  return NextResponse.json({
    valid: true,
    company: cc.eventHost.name,
    label: cc.label,
    // Betraege und Restkontingente bleiben drinnen. Die Buchungsseite braucht
    // nur zu wissen, DASS noch etwas frei ist.
    hasBudget: (remaining.remainingCents ?? 1) > 0 && (remaining.remainingRides ?? 1) > 0,
    validUntil: cc.validUntil,
  });
}
