import { NextResponse } from "next/server";
import { geocode, reverseGeocode } from "@/lib/geo";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const GEO_LIMIT_IP = Number(process.env.GEOCODE_LIMIT_IP ?? 120);
const GEO_LIMIT_OHNE_IP = Number(process.env.GEOCODE_LIMIT_ANON ?? 600);

// Nur einmal pro Prozess warnen, sonst flutet es das Protokoll.
let ohneIpGemeldet = false;
function warnOhneIp(): void {
  if (ohneIpGemeldet || process.env.NODE_ENV !== "production") return;
  ohneIpGemeldet = true;
  console.warn(
    "Adresssuche ohne erkennbare Client-IP: alle Aufrufer teilen sich ein " +
      "gemeinsames Limit. Bitte TRUSTED_PROXY_HOPS pruefen (Render: 1).",
  );
}

export async function GET(req: Request) {
  // Diese Route ist ein Proxy auf einen KOSTENPFLICHTIGEN Kartendienst und
  // muss fuer Gaeste offen bleiben (Adresseingabe vor dem Buchen). Ohne
  // Drosselung liesse sie sich aber als Gratis-Geocoder missbrauchen und
  // verursacht echte Kosten.
  //
  // Ohne erkennbare IP (falsch gesetztes TRUSTED_PROXY_HOPS) teilen sich ALLE
  // Aufrufer einen einzigen Topf. Der darf deshalb nicht knapp sein, sonst
  // legt eine Fehlkonfiguration die Adresssuche fuer jeden lahm – und das
  // sieht aus wie ein Totalausfall, nicht wie ein Konfigurationsfehler.
  // Missbrauch ist auch bei diesem Wert noch gedeckelt.
  const ip = clientIp(req);
  const limit = rateLimit(
    `geocode:${ip ?? "ohne-ip"}`,
    ip ? GEO_LIMIT_IP : GEO_LIMIT_OHNE_IP,
    10 * 60_000,
  );
  if (!ip) warnOhneIp();
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
