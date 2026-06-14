import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const rating = Number(json?.rating);
  const comment = typeof json?.comment === "string" ? json.comment.slice(0, 500) : null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Bewertung muss zwischen 1 und 5 liegen" }, { status: 400 });
  }
  const booking = await prisma.booking.findUnique({ where: { id: params.id } });
  if (!booking) return NextResponse.json({ error: "Auftrag nicht gefunden" }, { status: 404 });

  await prisma.booking.update({
    where: { id: params.id },
    data: { rating, ratedAt: new Date(), ratingComment: comment },
  });
  return NextResponse.json({ ok: true });
}
