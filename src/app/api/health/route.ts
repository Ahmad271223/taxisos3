import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Zustandspruefung fuer den Hoster (Render: Health Check Path = /api/health).
 *
 * Bewusst OHNE Anmeldung und OHNE Geschaeftsdaten: die Antwort sagt nur, ob
 * der Prozess laeuft und ob er die Datenbank erreicht. Zaehlwerte (Fahrten,
 * Umsaetze) haben hier nichts verloren – der Endpunkt ist oeffentlich.
 *
 * Warum die Datenbank mitgeprueft wird: ein Prozess, der zwar HTTP beantwortet,
 * aber keine Datenbankverbindung mehr hat, ist fuer den Betrieb wertlos. Ohne
 * diese Pruefung wuerde der Hoster ihn faelschlich als gesund fuehren und
 * keinen Neustart ausloesen.
 */
export async function GET() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { ok: true, datenbank: "erreichbar", dauerMs: Date.now() - start, zeit: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    console.error("Zustandspruefung fehlgeschlagen:", e?.message ?? e);
    return NextResponse.json(
      { ok: false, datenbank: "nicht erreichbar", dauerMs: Date.now() - start, zeit: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
