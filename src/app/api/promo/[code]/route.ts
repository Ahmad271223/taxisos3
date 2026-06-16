import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { promoUsable, promoLabelText } from "@/lib/promo";

export const dynamic = "force-dynamic";

// Öffentliche Promo-Validierung für die Buchungsformulare.
export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const code = (params.code ?? "").toUpperCase().replace(/\s+/g, "");
  const promo = await prisma.promoCode.findUnique({ where: { code } });
  if (!promo || !promoUsable(promo)) {
    return NextResponse.json({ valid: false }, { status: promo ? 200 : 404 });
  }
  return NextResponse.json({
    valid: true,
    code: promo.code,
    discountType: promo.discountType,
    discountValue: promo.discountValue,
    label: promo.label ?? promoLabelText(promo),
  });
}
