import { NextResponse } from "next/server";
import { getVapidPublicKey, webPushEnabled } from "@/lib/webpush";

export const dynamic = "force-dynamic";

// Öffentlicher VAPID-Key für das Abonnieren von Push im Browser.
export async function GET() {
  return NextResponse.json({ enabled: webPushEnabled(), publicKey: getVapidPublicKey() || null });
}
