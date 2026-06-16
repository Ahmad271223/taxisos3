import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX = 2_000_000; // ~1.4 MB PNG
const schema = z.object({
  signedName: z.string().max(120).optional().nullable(),
  dataBase64: z.string().min(20).max(MAX),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
});

// Digitalen Fahrtnachweis speichern (Unterschrift + Zeitstempel + GPS). Die
// bookingId dient als Capability; eine Unterschrift je Fahrt (Upsert).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const booking = await prisma.booking.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
  if (!booking) return NextResponse.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
  if (booking.status === "STORNIERT") return NextResponse.json({ error: "Fahrt storniert" }, { status: 409 });

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Unterschrift fehlt oder zu groß." }, { status: 400 });
  const d = parsed.data;
  const data = d.dataBase64.replace(/^data:image\/png;base64,/, "");

  const sig = await prisma.rideSignature.upsert({
    where: { bookingId: booking.id },
    create: { bookingId: booking.id, signedName: d.signedName ?? null, dataBase64: data, lat: d.lat ?? null, lng: d.lng ?? null, signedAt: new Date() },
    update: { signedName: d.signedName ?? null, dataBase64: data, lat: d.lat ?? null, lng: d.lng ?? null, signedAt: new Date() },
    select: { id: true, signedAt: true, signedName: true },
  });
  return NextResponse.json({ signature: { ...sig, hasSignature: true } }, { status: 201 });
}

// Fahrtnachweis abrufen: Metadaten (JSON) oder das PNG-Bild (?format=png).
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const sig = await prisma.rideSignature.findUnique({ where: { bookingId: params.id } });
  if (!sig) return NextResponse.json({ hasSignature: false }, { status: 404 });
  if (new URL(req.url).searchParams.get("format") === "png") {
    return new NextResponse(Buffer.from(sig.dataBase64, "base64"), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  }
  return NextResponse.json({ hasSignature: true, signedName: sig.signedName, signedAt: sig.signedAt, lat: sig.lat, lng: sig.lng });
}
