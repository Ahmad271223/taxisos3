import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rideReceiptPdf } from "@/lib/ridePdf";
import { vehicleClass as vehicleClassInfo } from "@/lib/vehicleClasses";
import { parseStops } from "@/lib/stops";
import { getSession } from "@/lib/session";
import { bookingRefWhereCustomer } from "@/lib/bookingRef";

export const dynamic = "force-dynamic";

// Fahrtbeleg als PDF (Phase 19) – nur für abgeschlossene Fahrten.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const b = await prisma.booking.findFirst({
    where: bookingRefWhereCustomer(params.id, getSession("customer")?.sub),
    // Aussteller des Belegs ist das Taxiunternehmen -> Anschrift und
    // Steuernummer gehoeren aufs Dokument (§ 33 UStDV).
    include: {
      driver: true,
      company: { select: { name: true, address: true, phone: true, email: true, taxId: true, vatId: true } },
    },
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
    tip: b.tip ?? 0,
    paymentMethod: b.paymentMethod,
    paymentStatus: b.paymentStatus,
    carrier: b.company?.name ?? null,
    carrierAddress: b.company?.address ?? null,
    carrierPhone: b.company?.phone ?? null,
    carrierEmail: b.company?.email ?? null,
    carrierTaxId: b.company?.taxId ?? null,
    carrierVatId: b.company?.vatId ?? null,
    // Schnappschuss zuerst: der Beleg muss auch dann stimmen, wenn der Fahrer
    // spaeter geloescht wird (Company->Driver ist eine Cascade-Loeschung).
    driverName: b.driverNameSnap ?? b.driver?.name ?? null,
    plate: b.driverPlateSnap ?? b.driver?.vehiclePlate ?? null,
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
