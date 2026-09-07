import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { bookingRefWhereCustomer } from "@/lib/bookingRef";

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
  const booking = await prisma.booking.findFirst({
    where: bookingRefWhereCustomer(params.id, getSession("customer")?.sub),
    select: { id: true, status: true, ratedAt: true },
  });
  if (!booking) return NextResponse.json({ error: "Auftrag nicht gefunden" }, { status: 404 });
  if (booking.status !== "ABGESCHLOSSEN") {
    return NextResponse.json({ error: "Bewerten geht erst nach dem Ende der Fahrt." }, { status: 409 });
  }
  if (booking.ratedAt) {
    return NextResponse.json({ error: "Diese Fahrt wurde bereits bewertet." }, { status: 409 });
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { rating, ratedAt: new Date(), ratingComment: comment },
  });
  return NextResponse.json({ ok: true });
}
