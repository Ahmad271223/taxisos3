import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { constructWebhookEvent } from "@/lib/stripe";
import { applySubscription, companyIdForCustomer } from "@/lib/subscription";

export const dynamic = "force-dynamic";

/**
 * Stripe-Webhook für BEIDE getrennten Geldflüsse:
 *
 *  1. FAHRT-Zahlungen  (Karte des Fahrgasts -> Konto des Taxiunternehmens)
 *     -> payment_intent.* hält den Zahlungsstatus der Buchung synchron.
 *
 *  2. UNTERNEHMENS-ABO (Karte des Unternehmens -> unser Plattform-Konto)
 *     -> customer.subscription.* / invoice.* pflegen Tarif, Status, Laufzeit.
 *
 * Beide teilen sich nur diesen Endpunkt; die Datensätze bleiben strikt
 * getrennt (Booking vs. Company).
 *
 * Benötigt STRIPE_WEBHOOK_SECRET. Ohne Konfiguration -> 503 (no-op).
 */
export async function POST(req: Request) {
  const raw = await req.text(); // Roh-Body für die Signaturprüfung
  const sig = req.headers.get("stripe-signature");
  const res = await constructWebhookEvent(raw, sig);
  if (!res.ok) {
    return NextResponse.json(
      { error: res.error ?? "invalid" },
      { status: res.error === "webhook_not_configured" ? 503 : 400 },
    );
  }
  const event = res.event;
  const obj: any = event.data?.object;

  try {
    // ---- 1. Fahrt-Zahlungen -------------------------------------------
    const rideStatus: Record<string, string> = {
      "payment_intent.succeeded": "BEZAHLT",
      "payment_intent.canceled": "STORNIERT",
      "payment_intent.payment_failed": "FEHLGESCHLAGEN",
    };
    if (rideStatus[event.type] && obj?.id) {
      await prisma.booking.updateMany({
        where: { paymentRef: obj.id },
        data: {
          paymentStatus: rideStatus[event.type],
          ...(event.type === "payment_intent.payment_failed"
            ? { paymentError: obj?.last_payment_error?.message ?? "Die Zahlung wurde abgelehnt." }
            : {}),
        },
      });
    }

    // ---- 2. Unternehmens-Abo ------------------------------------------
    if (event.type.startsWith("customer.subscription.")) {
      const companyId =
        obj?.metadata?.companyId ?? (obj?.customer ? await companyIdForCustomer(obj.customer) : null);
      if (companyId) {
        if (event.type === "customer.subscription.deleted") {
          await prisma.company.update({ where: { id: companyId }, data: { subscriptionStatus: "GEKUENDIGT" } });
        } else {
          await applySubscription(companyId, obj);
        }
      }
    }

    // Rechnung bezahlt / fehlgeschlagen -> Abo-Status nachziehen.
    if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const companyId = obj?.customer ? await companyIdForCustomer(obj.customer) : null;
      if (companyId) {
        await prisma.company.update({
          where: { id: companyId },
          data: {
            subscriptionStatus: event.type === "invoice.paid" ? "AKTIV" : "UEBERFAELLIG",
            ...(event.type === "invoice.paid" && obj?.period_end
              ? { subscriptionUntil: new Date(obj.period_end * 1000) }
              : {}),
          },
        });
      }
    }

    // Abo direkt nach dem Checkout aktivieren (schneller als subscription.created).
    if (event.type === "checkout.session.completed" && obj?.mode === "subscription") {
      const companyId =
        obj?.metadata?.companyId ?? (obj?.customer ? await companyIdForCustomer(obj.customer) : null);
      if (companyId && obj?.subscription) {
        await prisma.company.update({
          where: { id: companyId },
          data: {
            stripeSubscriptionId: obj.subscription,
            subscriptionStatus: "AKTIV",
            ...(obj?.metadata?.planId ? { plan: obj.metadata.planId } : {}),
          },
        });
      }
    }
  } catch (e) {
    // Idempotent bleiben: Fehler nicht an Stripe zurueckwerfen (sonst Retry-Sturm).
    console.error("Webhook-Verarbeitung:", (e as Error)?.message);
  }

  return NextResponse.json({ received: true });
}
