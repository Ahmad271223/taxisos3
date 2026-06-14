import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { sendSms } from "@/lib/notify";
import { getRuntime, getDispatcher } from "@/server/runtime";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  bookingId: z.string().optional().nullable(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  message: z.string().max(300).optional().nullable(),
});

// SOS-/Notfallmeldung (Phase 17): legt eine Meldung an, alarmiert die Plattform
// und den hinterlegten Notfallkontakt und pusht sie an das betroffene Unternehmen.
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (ip) {
    const r = rateLimit(`sos:ip:${ip}`, 10, 5 * 60_000);
    if (!r.ok) return NextResponse.json({ error: "Zu viele SOS-Meldungen." }, { status: 429 });
  }

  let json: any;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Daten" }, { status: 400 });
  const d = parsed.data;

  const booking = d.bookingId ? await prisma.booking.findUnique({ where: { id: d.bookingId } }) : null;
  const session = getSession("customer");
  const customer = session ? await prisma.customer.findUnique({ where: { id: session.sub } }) : null;

  const customerName = customer?.name ?? booking?.customerName ?? "Unbekannt";
  const customerPhone = customer?.phone ?? booking?.customerPhone ?? "";
  const lat = d.lat ?? booking?.pickupLat ?? null;
  const lng = d.lng ?? booking?.pickupLng ?? null;
  const companyId = booking?.companyId ?? null;

  const alert = await prisma.sosAlert.create({
    data: {
      bookingId: d.bookingId ?? null,
      customerId: customer?.id ?? null,
      customerName,
      customerPhone,
      lat,
      lng,
      message: d.message ?? null,
      companyId,
    },
  });

  // Echtzeit an das betroffene Unternehmen (Admin-Dashboard).
  try {
    const io = getRuntime()?.io;
    if (io && companyId) {
      io.to(`admins:${companyId}`).emit("admin:sos", {
        id: alert.id,
        bookingId: alert.bookingId,
        customerName,
        customerPhone,
        lat,
        lng,
        message: alert.message,
        createdAt: alert.createdAt.toISOString(),
      });
    }
  } catch {
    /* Push ist optional */
  }

  // Notfallkontakt + Plattform per SMS alarmieren (Mock, wenn kein Anbieter).
  const mapsLink = lat != null && lng != null ? ` Standort: https://maps.google.com/?q=${lat},${lng}` : "";
  const text = `NOTFALL: ${customerName} (${customerPhone}) hat SOS ausgelöst.${mapsLink}`;
  const targets: string[] = [];
  if (customer?.emergencyContactPhone) targets.push(customer.emergencyContactPhone);
  const platform = (process.env.PLATFORM_PHONE ?? process.env.NEXT_PUBLIC_PLATFORM_PHONE ?? "").trim();
  if (platform) targets.push(platform);
  await Promise.all(targets.map((t) => sendSms(t, text).catch(() => null)));

  // Automatische Notfall-Rettungsfahrt (Phase 21): mit gespeichertem Standort
  // wird sofort der nächste freie Fahrer zum SOS-Ort geschickt. Der Standort
  // ist serverseitig gesichert – das Gerät darf danach ausgehen.
  let rescueBookingId: string | null = null;
  let rescueDriver: any = null;
  if (lat != null && lng != null) {
    const rescue = await prisma.booking.create({
      data: {
        customerName,
        customerPhone,
        customerId: customer?.id ?? null,
        pickupAddress: "SOS-Notfallstandort",
        pickupLat: lat,
        pickupLng: lng,
        destAddress: "SOS-Notfallstandort",
        destLat: lat,
        destLng: lng,
        vehicleClass: "STANDARD",
        isSos: true,
        notes: `SOS-Notruf${d.message ? ": " + d.message : ""}`,
        status: "OFFEN",
        trackingStatus: "SUCHE",
        paymentMethod: "CASH",
        priceApprox: 0,
      },
    });
    rescueBookingId = rescue.id;
    await prisma.sosAlert.update({ where: { id: alert.id }, data: { rescueBookingId: rescue.id } });
    try {
      const res = await getDispatcher()?.dispatchSosRescue(rescue.id);
      if (res?.ok) rescueDriver = { ...res.driver, etaSeconds: res.etaSeconds ?? null };
      // Meldung dem Unternehmen des reagierenden Fahrers zuordnen, damit dessen
      // Admin den Notfall live im Dashboard sieht.
      const assigned = await prisma.booking.findUnique({ where: { id: rescue.id }, select: { companyId: true } });
      if (assigned?.companyId && assigned.companyId !== companyId) {
        await prisma.sosAlert.update({ where: { id: alert.id }, data: { companyId: assigned.companyId } });
        try {
          getRuntime()?.io?.to(`admins:${assigned.companyId}`).emit("admin:sos", {
            id: alert.id,
            bookingId: alert.bookingId,
            customerName,
            customerPhone,
            lat,
            lng,
            message: alert.message,
            createdAt: alert.createdAt.toISOString(),
          });
        } catch {
          /* Push optional */
        }
      }
    } catch {
      /* Dispatch-Fehler darf die SOS-Meldung nicht scheitern lassen */
    }
  }

  return NextResponse.json(
    { ok: true, id: alert.id, notified: targets.length, rescueBookingId, rescueDriver },
    { status: 201 },
  );
}
