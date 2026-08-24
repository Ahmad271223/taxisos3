// Web-Push für Fahrer-Geräte: Benachrichtigung über neue Fahrtangebote, auch
// wenn die App im Hintergrund/Tab inaktiv ist. Ohne VAPID-Keys (lokal/Demo)
// wird nichts gesendet (No-Op, analog zu lib/notify ohne Twilio-Key).
import { prisma } from "./prisma";

type WebPushModule = typeof import("web-push");

let mod: WebPushModule | null = null;
let configured = false;

function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:dispatch@taxilive.app";
  return { publicKey, privateKey, subject };
}

export function webPushEnabled(): boolean {
  const { publicKey, privateKey } = vapid();
  return !!(publicKey && privateKey);
}

// Öffentlicher VAPID-Key für den Client (zum Abonnieren).
export function getVapidPublicKey(): string {
  return vapid().publicKey;
}

function getModule(): WebPushModule | null {
  if (!webPushEnabled()) return null;
  if (!mod) {
    try {
      // Lazy require, damit ohne Keys keine Abhängigkeit nötig ist.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require("web-push") as WebPushModule;
    } catch {
      return null;
    }
  }
  if (!configured && mod) {
    const { publicKey, privateKey, subject } = vapid();
    try {
      mod.setVapidDetails(subject, publicKey, privateKey);
      configured = true;
    } catch {
      return null;
    }
  }
  return mod;
}

export type PushSubInput = { endpoint: string; keys: { p256dh: string; auth: string } };

// Subscription eines Fahrer-Geräts speichern (idempotent per endpoint).
export async function saveSubscription(driverId: string, sub: PushSubInput, userAgent?: string) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error("invalid subscription");
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { driverId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent ?? null },
    update: { driverId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent ?? null },
  });
}

export async function removeSubscription(endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } }).catch(() => {});
}

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  data?: Record<string, unknown>;
};

// Push an alle Geräte eines Fahrers senden. Abgelaufene/ungültige
// Subscriptions (404/410) werden automatisch entfernt.
export async function sendToDriver(driverId: string, payload: PushPayload): Promise<number> {
  const wp = getModule();
  if (!wp) return 0;
  const subs = await prisma.pushSubscription.findMany({ where: { driverId } });
  if (subs.length === 0) return 0;
  const json = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await wp.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          json,
          { TTL: 120, urgency: "high" },
        );
        sent++;
      } catch (err: any) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) await removeSubscription(s.endpoint);
      }
    }),
  );
  return sent;
}

// Rueckfrage 30 Min vor einer reservierten Vorbestellung pushen. Wichtig,
// wenn die App im Hintergrund laeuft oder das Handy gesperrt ist.
export async function notifyDriverConfirm(driverId: string, booking: any): Promise<void> {
  if (!webPushEnabled()) return;
  const when = booking?.scheduledAt
    ? new Date(booking.scheduledAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : "";
  const from = booking?.pickupAddress ? String(booking.pickupAddress).split(",")[0] : "Abholung";
  await sendToDriver(driverId, {
    title: "Fahrt in 30 Minuten",
    body: `Möchtest du die Fahrt${when ? ` um ${when} Uhr` : ""} (${from}) weiterhin durchführen?`,
    tag: `confirm-${booking?.id ?? "x"}`,
    url: "/fahrer",
    data: { bookingId: booking?.id ?? null, kind: "confirmScheduled" },
  }).catch(() => {});
}

// Komfort: ein neues Fahrtangebot pushen.
export async function notifyDriverOffer(driverId: string, dto: any): Promise<void> {
  if (!webPushEnabled()) return;
  const from = dto?.pickupAddress ? String(dto.pickupAddress).split(",")[0] : "Abholung";
  const to = dto?.destAddress ? String(dto.destAddress).split(",")[0] : "Ziel";
  const vip = dto?.isVip ? "⭐ VIP · " : "";
  await sendToDriver(driverId, {
    title: "🚕 Neue Fahrtanfrage",
    body: `${vip}${from} → ${to}`,
    tag: `offer-${dto?.id ?? "x"}`,
    url: "/fahrer",
    data: { bookingId: dto?.id ?? null, kind: "offer" },
  }).catch(() => {});
}
