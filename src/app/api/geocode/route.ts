import { NextResponse } from "next/server";
import { geocode, reverseGeocode } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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
