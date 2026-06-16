import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { haversineMeters } from "@/lib/geo";

export const dynamic = "force-dynamic";

// Öffentlich: liefert den nächsten aktiven Event-Sammelpunkt, in dessen Radius
// die angefragte Position liegt (sonst null). Für die Buchungsformulare, die
// die Abholung auf den virtuellen Taxistand lenken.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ zone: null }, { status: 400 });
  }
  const zones = await prisma.eventZone.findMany({ where: { active: true }, take: 500 });
  let best: { zone: any; dist: number } | null = null;
  for (const z of zones) {
    const dist = haversineMeters({ lat, lng }, { lat: z.lat, lng: z.lng });
    if (dist <= z.radiusMeters && (!best || dist < best.dist)) best = { zone: z, dist };
  }
  if (!best) return NextResponse.json({ zone: null });
  return NextResponse.json({
    zone: { id: best.zone.id, name: best.zone.name, lat: best.zone.lat, lng: best.zone.lng, distance: Math.round(best.dist) },
  });
}
