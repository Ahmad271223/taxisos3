import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rideReceiptPdf } from "@/lib/ridePdf";
import { vehicleClass as vehicleClassInfo } from "@/lib/vehicleClasses";
import { parseStops } from "@/lib/stops";
import { bookingRefWhere } from "@/lib/bookingRef";

export const dynamic = "force-dynamic";

// Fahrtbeleg als PDF (Phase 19) – nur für abgeschlossene Fahrten.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const b = await prisma.booking.findFirst({
    where: bookingRefWhere(params.id),
    include: { driver: true, company: { select: { name: true } } },
  });
  if (!b) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const fare = b.fare ?? b.priceExact ?? null;
  if (b.status !== "ABGESCHLOSSEN" || fare == null) {
    return NextResponse.json({ error: "Beleg erst nach Abschluss der Fahrt verfügbar." }, { status: 409 });
  }

  const pdf = await rideReceiptPdf({
    receiptNo: `TX-${b.id.slice(-8).toUpperCase()}`,
    dateIso: (b.completedAt ?? b.createdAt).toISOString(),
    customerName: b.customerName,
    pickup: b.pickupAddress,
    dest: b.destAddress,
    stops: parseStops(b.stops).map((s) => s.address),
    vehicleClassLabel: vehicleClassInfo(b.vehicleClass).label,
    distanceMeters: b.distanceMeters ?? null,
    fare,
    paymentMethod: b.paymentMethod,
    paymentStatus: b.paymentStatus,
    carrier: b.company?.name ?? null,
    driverName: b.driver?.name ?? null,
    plate: b.driver?.vehiclePlate ?? null,
  });

  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Fahrtbeleg-${b.id.slice(-8)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
