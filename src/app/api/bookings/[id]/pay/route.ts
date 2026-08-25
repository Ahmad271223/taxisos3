import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { bookingRefWhereCustomer } from "@/lib/bookingRef";
import { settleRide, prepareRidePayment, TIP_WINDOW_MS, capTip } from "@/lib/settle";
import { cardIsExpired } from "@/lib/customerCards";
import { getDispatcher } from "@/server/runtime";

export const dynamic = "force-dynamic";

// Zustand der Nachfahrt-Zahlung: Fahrpreis, offenes Trinkgeld-Fenster,
// verfuegbare Karten und ggf. der Fehler einer misslungenen Belastung.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const b = await prisma.booking.findFirst({
    where: bookingRefWhereCustomer(params.id, getSession("customer")?.sub),
    include: { card: true },
  });
  if (!b) return NextResponse.json({ error: "Fahrt nicht gefunden" }, { status: 404 });

  const isCard = b.paymentMethod === "CARD";
  const finished = b.status === "ABGESCHLOSSEN";
  const deadline = b.tipPromptedAt ? new Date(b.tipPromptedAt.getTime() + TIP_WINDOW_MS) : null;

  // Bei einem Zahlungsproblem braucht der Kunde sofort die Auswahl seiner
  // anderen Karten – auch schon waehrend der Fahrt, wenn die Deckungspruefung
  // beim Start fehlgeschlagen ist.
  const failed = isCard && b.paymentStatus === "FEHLGESCHLAGEN";
  const alternatives =
    failed && b.customerId
      ? await prisma.customerCard.findMany({
          where: { customerId: b.customerId },
          orderBy: { isDefault: "desc" },
        })
      : [];

  return NextResponse.json({
    bookingId: b.id,
    paymentMethod: b.paymentMethod,
    paymentStatus: b.paymentStatus,
    fare: b.fare ?? null,
    tip: b.tip ?? 0,
    total: Math.round(((b.fare ?? 0) + (b.tip ?? 0)) * 100) / 100,
    // Trinkgeld-Auswahl ist NUR nach Fahrtende und NUR bei Kartenzahlung offen.
    tipWindowOpen: isCard && finished && b.paymentStatus === "KARTE_HINTERLEGT",
    tipDeadline: deadline,
    tipWindowSeconds: Math.round(TIP_WINDOW_MS / 1000),
    paymentError: b.paymentError ?? null,
    card: b.card
      ? {
          id: b.card.id,
          brand: b.card.brand,
          last4: b.card.last4,
          expired: cardIsExpired(b.card.expMonth, b.card.expYear),
        }
      : null,
    // Nur bei einem Problem gefuellt: andere Karten zum Wechseln.
    cards: alternatives.map((c) => ({
      id: c.id,
      brand: c.brand,
      last4: c.last4,
      expired: cardIsExpired(c.expMonth, c.expYear),
    })),
  });
}

/**
 * Endgueltige Zahlung nach Fahrtende.
 * Body: { tip?: number, tipPercent?: number, cardId?: string }
 *  - tip = 0 bzw. kein Wert  -> ausdruecklich ohne Trinkgeld
 *  - cardId                  -> andere gespeicherte Karte verwenden (nach Fehler)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let json: any = {};
  try {
    json = await req.json();
  } catch {
    /* leerer Body = ohne Trinkgeld zahlen */
  }

  const b = await prisma.booking.findFirst({
    where: bookingRefWhereCustomer(params.id, getSession("customer")?.sub),
    select: {
      id: true,
      customerId: true,
      paymentMethod: true,
      paymentStatus: true,
      status: true,
      fare: true,
      tip: true,
    },
  });
  if (!b) return NextResponse.json({ error: "Fahrt nicht gefunden" }, { status: 404 });

  if (b.paymentMethod !== "CARD") {
    return NextResponse.json(
      { error: "Diese Fahrt wird bar bezahlt – es ist keine Zahlung in der App nötig.", code: "CASH_RIDE" },
      { status: 400 },
    );
  }
  if (b.paymentStatus === "BEZAHLT") {
    return NextResponse.json({ ok: true, alreadyPaid: true, fare: b.fare, tip: b.tip });
  }

  // Andere Karte waehlen (z. B. nach abgelehnter Zahlung) – nur der
  // Kontoinhaber darf das, und nur mit einer eigenen, gueltigen Karte.
  const requestedCardId = typeof json?.cardId === "string" ? json.cardId : null;
  if (requestedCardId) {
    const session = getSession("customer");
    if (!session || session.sub !== b.customerId) {
      return NextResponse.json({ error: "Bitte melden Sie sich an, um die Karte zu wechseln." }, { status: 401 });
    }
    const card = await prisma.customerCard.findFirst({ where: { id: requestedCardId, customerId: session.sub } });
    if (!card) return NextResponse.json({ error: "Karte nicht gefunden." }, { status: 404 });
    if (cardIsExpired(card.expMonth, card.expYear)) {
      return NextResponse.json({ error: "Diese Karte ist abgelaufen." }, { status: 400 });
    }
    await prisma.booking.update({
      where: { id: b.id },
      data: { cardId: card.id, paymentRef: null, priceAuthorized: null },
    });
  }

  // Laeuft die Fahrt noch? Dann wird hier nichts abgebucht. Hat die
  // Deckungspruefung beim Start versagt, kann der Kunde jetzt aber eine
  // andere Karte hinterlegen – sie wird sofort erneut geprueft, damit das
  // Problem vor dem Fahrtende geloest ist.
  if (b.status !== "ABGESCHLOSSEN") {
    if (!requestedCardId) {
      return NextResponse.json(
        { error: "Die Zahlung ist erst nach Ende der Fahrt möglich.", code: "RIDE_NOT_FINISHED" },
        { status: 409 },
      );
    }
    const retry = await prepareRidePayment(b.id);
    getDispatcher()?.refreshBooking?.(b.id).catch?.(() => {});
    if (!retry.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: retry.code ?? "PAYMENT_FAILED",
          error: "Auch diese Karte wurde abgelehnt. Bitte wählen Sie eine andere oder zahlen Sie bar.",
          detail: retry.error,
          paymentStatus: "FEHLGESCHLAGEN",
        },
        { status: 402 },
      );
    }
    return NextResponse.json({
      ok: true,
      paymentStatus: "KARTE_HINTERLEGT",
      authorized: retry.authorized ?? null,
      message: "Ihre Karte wurde bestätigt. Die Zahlung erfolgt nach der Fahrt.",
    });
  }

  // Trinkgeld: absoluter Betrag oder Prozentsatz vom Fahrpreis. Fehlt beides,
  // wird ohne Trinkgeld bezahlt (Punkt 12 – immer moeglich).
  const fare = b.fare ?? 0;
  let tip = 0;
  if (Number.isFinite(Number(json?.tip))) tip = Number(json.tip);
  else if (Number.isFinite(Number(json?.tipPercent))) tip = (fare * Number(json.tipPercent)) / 100;
  tip = capTip(fare, Math.round(tip * 100) / 100);

  const result = await settleRide(b.id, tip);

  // Kunde, Fahrer und Zentrale ueber den neuen Zahlungsstatus informieren.
  getDispatcher()?.refreshBooking?.(b.id).catch?.(() => {});

  if (!result.ok && result.status === "FEHLGESCHLAGEN") {
    const cards = b.customerId
      ? await prisma.customerCard.findMany({ where: { customerId: b.customerId }, orderBy: { isDefault: "desc" } })
      : [];
    return NextResponse.json(
      {
        ok: false,
        code: result.code ?? "PAYMENT_FAILED",
        error:
          "Die Zahlung für Ihre Fahrt konnte nicht durchgeführt werden. Bitte aktualisieren Sie Ihre Zahlungsmethode.",
        detail: result.error,
        paymentStatus: "FEHLGESCHLAGEN",
        // Auswahl fuer den erneuten Versuch.
        cards: cards.map((c) => ({
          id: c.id,
          brand: c.brand,
          last4: c.last4,
          expired: cardIsExpired(c.expMonth, c.expYear),
        })),
      },
      { status: 402 },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error ?? "Zahlung nicht möglich." }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    paymentStatus: "BEZAHLT",
    fare: result.fare,
    tip: result.tip,
    total: result.amount,
  });
}
