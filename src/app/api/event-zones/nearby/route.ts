import { NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/ratelimit";
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
  // Oeffentliche Route ohne jede Bremse, die je Aufruf Datenbankarbeit
  // ausloest. Und `isFinite` allein laesst Koordinaten zu, die es nicht gibt.
  const ip = clientIp(req);
  if (!rateLimit(ip ? `zonen:${ip}` : "zonen:ohne-adresse", 60, 10 * 60_000).ok) {
    return NextResponse.json({ error: "Zu viele Abfragen. Bitte später erneut." }, { status: 429 });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ zone: null }, { status: 400 });
  }
  // Feste Reihenfolge: ohne `orderBy` war bei mehr als 500 aktiven Zonen nicht
  // einmal festgelegt, WELCHE 500 geprueft werden.
  const zones = await prisma.eventZone.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
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
