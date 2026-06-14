import { NextResponse } from "next/server";
import { z } from "zod";
import { estimatePriceViaWith } from "@/lib/geo";
import { pricingForSlug } from "@/lib/pricing";
import { normalizeStops } from "@/lib/stops";
import { createAuthIntent, paymentEnabled } from "@/lib/stripe";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const point = z.object({ lat: z.number(), lng: z.number() });
const schema = z.object({
  pickup: point,
  dest: point,
  stops: z.array(z.object({ lat: z.number(), lng: z.number() })).max(8).optional(),
  company: z.string().min(1).optional().nullable(),
});

/**
 * Erstellt einen PaymentIntent (manueller Capture / Hold) für eine Kartenzahlung.
 * Der Betrag wird SERVERSEITIG aus der Route berechnet (obere Preisschaetzung),
 * nicht vom Client übernommen. Der Client bestätigt den Intent dann mit der
 * eingegebenen Karte (Stripe Elements). Ohne Stripe-Key -> Mock.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (ip) {
    const r = rateLimit(`pi:ip:${ip}`, 30, 10 * 60_000);
    if (!r.ok) return NextResponse.json({ error: "Zu viele Anfragen." }, { status: 429 });
  }

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Start- und Zielkoordinaten erforderlich" }, { status: 400 });
  }
  const d = parsed.data;

  const pricing = await pricingForSlug(d.company ?? undefined);
  const points = [
    { lat: d.pickup.lat, lng: d.pickup.lng },
    ...normalizeStops(d.stops).map((s) => ({ lat: s.lat, lng: s.lng })),
    { lat: d.dest.lat, lng: d.dest.lng },
  ];
  const estimate = await estimatePriceViaWith(points, pricing);

  const intent = await createAuthIntent(estimate.priceMax, { kind: "taxi_ride" });
  if (!intent.ok) {
    return NextResponse.json({ error: "Zahlung konnte nicht vorbereitet werden." }, { status: 502 });
  }

  return NextResponse.json({
    enabled: paymentEnabled(),
    mock: intent.mock,
    clientSecret: intent.clientSecret,
    paymentIntentId: intent.id,
    amount: intent.amount, // Cent
    priceMax: estimate.priceMax,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
  });
}
