import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  const hotel = await prisma.hotel.findUnique({ where: { id: session.sub }, select: { preferredCompanyIds: true, defaultPickupAddress: true, defaultPickupLat: true, defaultPickupLng: true } });
  return NextResponse.json({
    preferredCompanyIds: (hotel?.preferredCompanyIds ?? "").split(",").filter(Boolean),
    defaultPickup: hotel?.defaultPickupAddress ? { address: hotel.defaultPickupAddress, lat: hotel.defaultPickupLat, lng: hotel.defaultPickupLng } : null,
  });
}

const schema = z.object({
  preferredCompanyIds: z.array(z.string()).max(50).optional(),
  defaultPickup: z.object({ address: z.string().min(1), lat: z.number(), lng: z.number() }).nullable().optional(),
});

// Flotten-Whitelist speichern (bevorzugte Firmen).
export async function PATCH(req: Request) {
  const session = requireRole("HOTEL");
  if (!session) return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  const d = parsed.data;

  const data: any = {};
  if (d.preferredCompanyIds) {
    // Nur existierende Firmen-IDs zulassen.
    const valid = await prisma.company.findMany({ where: { id: { in: d.preferredCompanyIds } }, select: { id: true } });
    data.preferredCompanyIds = valid.map((c) => c.id).join(",");
  }
  if (d.defaultPickup !== undefined) {
    data.defaultPickupAddress = d.defaultPickup?.address ?? null;
    data.defaultPickupLat = d.defaultPickup?.lat ?? null;
    data.defaultPickupLng = d.defaultPickup?.lng ?? null;
  }
  const hotel = await prisma.hotel.update({ where: { id: session.sub }, data });
  return NextResponse.json({
    preferredCompanyIds: (hotel.preferredCompanyIds ?? "").split(",").filter(Boolean),
    defaultPickup: hotel.defaultPickupAddress ? { address: hotel.defaultPickupAddress, lat: hotel.defaultPickupLat, lng: hotel.defaultPickupLng } : null,
  });
}
