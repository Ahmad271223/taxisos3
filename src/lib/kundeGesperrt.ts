import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Ein gesperrtes Kundenkonto darf nichts mehr veraendern.
 *
 * Die Sperre wurde bisher nur an einzelnen Stellen geprueft (Buchung, neue
 * Karte). Alles andere - Karte wechseln, Standardkarte setzen, Karte loeschen -
 * lief mit einer bereits offenen Sitzung weiter.
 *
 * Rueckgabe: eine fertige Antwort, wenn gesperrt; sonst null.
 */
export async function kontoGesperrt(customerId: string): Promise<NextResponse | null> {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { blocked: true, blockedReason: true },
  });
  if (!c?.blocked) return null;
  return NextResponse.json(
    {
      error: c.blockedReason ?? "Ihr Konto ist gesperrt. Bitte wenden Sie sich an unsere Zentrale.",
      code: "ACCOUNT_BLOCKED",
    },
    { status: 403 },
  );
}
