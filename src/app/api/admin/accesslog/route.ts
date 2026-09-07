import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Zugriffsprotokoll (Phase F / DSGVO) – nur Admin. Zugriffe auf Gesundheits-
 * und Patientendaten der eigenen Firma.
 *
 * MANDANTENTRENNUNG: Ein Unternehmen sieht ausschliesslich Eintraege mit
 * seiner eigenen Kennung. Eintraege OHNE Firma – etwa der Zugriff einer
 * Einrichtung auf ihre eigene Patientenakte – bleiben hier bewusst draussen:
 * Sie gehoeren keiner Zentrale, und sie allen zu zeigen waere ein Leck ueber
 * Mandantengrenzen hinweg. Dass diese Zugriffe protokolliert werden, gilt
 * trotzdem; sie gehoeren in die Auskunft der Einrichtung bzw. des
 * Plattformbetreibers, nicht in die Ansicht einer beliebigen Taxizentrale.
 *
 * BLAETTERN: Frueher endete die Liste hart nach 200 Eintraegen – aeltere
 * Zugriffe waren ueber dieses Werkzeug dann gar nicht mehr auffindbar, was den
 * Zweck eines Protokolls verfehlt. Jetzt mit `cursor`.
 */
export async function GET(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });

  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const limit = Math.min(200, Math.max(10, parseInt(url.searchParams.get("limit") ?? "200", 10) || 200));
  const cursor = url.searchParams.get("cursor") || null;

  const where: any = { companyId: session.companyId };
  if (entity) where.entity = entity;

  // Einen Eintrag mehr holen als angefragt: so wissen wir, ob es weitergeht,
  // ohne zusaetzlich zaehlen zu muessen.
  const gefunden = await prisma.accessLog.findMany({
    where,
    orderBy: { at: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const weitere = gefunden.length > limit;
  const entries = weitere ? gefunden.slice(0, limit) : gefunden;

  return NextResponse.json({
    entries,
    nextCursor: weitere ? entries[entries.length - 1]?.id ?? null : null,
  });
}
