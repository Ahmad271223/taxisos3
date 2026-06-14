import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { constructWebhookEvent } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe-Webhook (echte Kartenzahlung): hält den Zahlungsstatus der Buchung
 * synchron, auch wenn Capture/Confirm asynchron abschließen. Benötigt
 * STRIPE_WEBHOOK_SECRET. Ohne Konfiguration -> 503 (no-op).
 */
export async function POST(req: Request) {
  const raw = await req.text(); // Roh-Body für die Signaturprüfung
  const sig = req.headers.get("stripe-signature");
  const res = await constructWebhookEvent(raw, sig);
  if (!res.ok) {
    return NextResponse.json({ error: res.error ?? "invalid" }, { status: res.error === "webhook_not_configured" ? 503 : 400 });
  }
  const event = res.event;

  try {
    const pi = event.data?.object;
    const ref: string | undefined = pi?.id;
    if (ref) {
      const map: Record<string, string> = {
        "payment_intent.succeeded": "BEZAHLT",
        "payment_intent.canceled": "STORNIERT",
        "payment_intent.payment_failed": "FEHLGESCHLAGEN",
      };
      const newStatus = map[event.type];
      if (newStatus) {
        await prisma.booking.updateMany({ where: { paymentRef: ref }, data: { paymentStatus: newStatus } });
      }
    }
  } catch {
    /* idempotent: Fehler nicht an Stripe zurückwerfen, sonst Retry-Sturm */
  }

  return NextResponse.json({ received: true });
}
