import { NextResponse } from "next/server";
import { aboGesperrt } from "@/lib/firmaAktiv";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let pricing = await prisma.pricing.findUnique({ where: { companyId: session.companyId } });
  if (!pricing) {
    // Ein GET soll eigentlich nichts aendern. Solange der Datensatz beim
    // ersten Oeffnen entstehen muss, wenigstens ohne Rennen: zwei gleichzeitige
    // Aufrufe liefen vorher beide in create und der zweite scheiterte an der
    // Eindeutigkeit.
    pricing = await prisma.pricing.upsert({
      where: { companyId: session.companyId },
      create: { companyId: session.companyId },
      update: {},
    });
  }
  return NextResponse.json({ pricing });
}

const schema = z.object({
  basePrice: z.number().min(0).max(100),
  perKmDay: z.number().min(0).max(100),
  perKmNight: z.number().min(0).max(100),
  perKmWeekend: z.number().min(0).max(100),
  perMinute: z.number().min(0).max(100).optional(),
  nightStartHour: z.number().int().min(0).max(23).optional(),
  nightEndHour: z.number().int().min(0).max(23).optional(),
  // Festpreis-Engine: dynamischer Risiko-Buffer (%) + Aufschlag je Zwischenstopp (€).
  fixedBufferPct: z.number().min(0).max(100).optional(),
  perStopFee: z.number().min(0).max(1000).optional(),
  // No-Show-Gebühr (€): wenn der Gast nach Ankunft nicht erscheint.
  noShowFee: z.number().min(0).max(1000).optional(),
  // Storno-Regeln.
  cancelFee: z.number().min(0).max(1000).optional(),
  freeCancelMinutes: z.number().int().min(0).max(1440).optional(),
});

export async function PUT(req: Request) {
  const session = requireRole("ADMIN");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  // Abo-Sperre: gekuendigt oder ueberfaellig -> keine betriebsrelevanten
  // Aenderungen mehr. Lesen bleibt erlaubt (Rechnungen, Belege, Abo-Seite).
  const abo = await aboGesperrt(session.companyId);
  if (abo) return abo;

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Preisdaten" }, { status: 400 });
  }
  const pricing = await prisma.pricing.upsert({
    where: { companyId: session.companyId },
    update: parsed.data,
    create: { companyId: session.companyId, ...parsed.data },
  });
  return NextResponse.json({ pricing });
}
