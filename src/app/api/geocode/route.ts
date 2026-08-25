import { NextResponse } from "next/server";
import { geocode, reverseGeocode } from "@/lib/geo";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Diese Route ist ein Proxy auf einen KOSTENPFLICHTIGEN Kartendienst und
  // muss fuer Gaeste offen bleiben (Adresseingabe vor dem Buchen). Ohne
  // Drosselung liesse sie sich aber als Gratis-Geocoder missbrauchen und
  // verursacht echte Kosten. Deshalb: pro IP begrenzen, ohne IP knapper.
  const ip = clientIp(req);
  const limit = rateLimit(`geocode:${ip ?? "ohne-ip"}`, ip ? 120 : 30, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { results: [], error: "Zu viele Adressabfragen. Bitte kurz warten.", retryAfter: limit.retryAfter },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(req.url);
  const reverse = searchParams.get("reverse");
  if (reverse) {
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    if (!isFinite(lat) || !isFinite(lng)) {
      return NextResponse.json({ results: [] });
    }
    const hit = await reverseGeocode(lat, lng);
    return NextResponse.json({ results: hit ? [hit] : [] });
  }

  const q = searchParams.get("q") ?? "";
  const results = await geocode(q, 6);
  return NextResponse.json({ results });
}
