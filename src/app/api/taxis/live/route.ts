import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDispatcher } from "@/server/runtime";
import { vehicleClass as vehicleClassInfo } from "@/lib/vehicleClasses";

export const dynamic = "force-dynamic";

// Live-Karte (Phase 16): alle eingeloggten Taxis (FREI/BESETZT) mit Position
// und öffentlichem Fahrzeug-/Fahrerprofil – damit Kunden gezielt eines wählen.
export async function GET() {
  const dispatcher = getDispatcher();
  const live = (dispatcher?.getLiveDrivers() ?? []).filter(
    (d) => d.online && d.lat != null && d.lng != null && (d.status === "FREI" || d.status === "BESETZT"),
  );
  if (live.length === 0) return NextResponse.json({ taxis: [], available: 0 });

  const rows = await prisma.driver.findMany({
    where: { id: { in: live.map((d) => d.id) }, active: true },
    include: { company: { select: { name: true } } },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const taxis = live
    .map((d) => {
      const r = byId.get(d.id);
      if (!r) return null;
      const c = vehicleClassInfo(d.vehicleClass);
      return {
        id: d.id,
        lat: d.lat,
        lng: d.lng,
        status: d.status, // FREI | BESETZT
        name: r.name,
        vehicleModel: r.vehicleModel ?? null,
        vehiclePlate: r.vehiclePlate ?? null,
        vehicleColor: r.vehicleColor ?? null,
        vehicleSeats: r.vehicleSeats ?? c.seats,
        vehicleClass: c.key,
        vehicleClassLabel: c.label,
        vehicleClassIcon: c.icon,
        luggage: c.luggage,
        company: r.company?.name ?? null,
      };
    })
    .filter(Boolean);

  const available = taxis.filter((t) => t && (t as any).status === "FREI").length;
  return NextResponse.json({ taxis, available });
}
