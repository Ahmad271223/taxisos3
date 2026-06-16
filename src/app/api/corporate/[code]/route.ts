import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeCorporateCode, corporateAvailable, corporateRemaining, corporateReasonText } from "@/lib/corporate";

export const dynamic = "force-dynamic";

// Öffentlich: löst einen Firmen-Mobilitäts-Code auf (für die QR-Landingpage und
// die Buchungs-Validierung). Liefert nur unkritische Eckdaten – keine internen IDs.
export async function GET(_req: Request, { params }: { params: { code: string } }) {
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
    perRideCents: cc.perRideCents,
    remainingCents: remaining.remainingCents,
    remainingRides: remaining.remainingRides,
    validUntil: cc.validUntil,
  });
}
