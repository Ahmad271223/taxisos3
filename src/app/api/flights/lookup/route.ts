import { NextResponse } from "next/server";
import { z } from "zod";
import { lookupFlight, flightProviderConfigured } from "@/lib/flights";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  flightNumber: z.string().min(2).max(10),
  direction: z.enum(["ARRIVAL", "DEPARTURE"]),
  date: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (ip) {
    const r = rateLimit(`flight:ip:${ip}`, 40, 10 * 60_000);
    if (!r.ok) return NextResponse.json({ error: "Zu viele Abfragen. Bitte später erneut." }, { status: 429 });
  }

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bitte gültige Flugnummer und Richtung angeben." }, { status: 400 });
  }
  const flight = await lookupFlight(parsed.data.flightNumber, parsed.data.direction, parsed.data.date ?? undefined);
  return NextResponse.json({ flight, live: flightProviderConfigured() });
}
