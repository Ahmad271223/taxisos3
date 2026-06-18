// Socket.IO-Verbindungslogik. Authentifizierung erfolgt ueber das
// Session-Cookie aus dem Handshake (httpOnly, kein Token im JS noetig).

import type { Server as IOServer, Socket } from "socket.io";
import { prisma } from "../lib/prisma";
import { verifySession, SESSION_COOKIE, ADMIN_COOKIE, DRIVER_COOKIE } from "../lib/auth";
import type { Dispatcher } from "./dispatch";
import { bookingDTO, driverAdmin, messageDTO } from "./serialize";

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

async function adminSnapshot(dispatcher: Dispatcher, companyId: string) {
  const dbDrivers = await prisma.driver.findMany({ where: { companyId }, orderBy: { name: "asc" } });
  const live = new Map(dispatcher.getLiveDrivers().map((d) => [d.id, d]));
  const drivers = dbDrivers.map((d) => {
    const l = live.get(d.id);
    return driverAdmin({
      ...d,
      status: l?.status ?? d.status,
      lat: l?.lat ?? d.lat,
      lng: l?.lng ?? d.lng,
    });
  });
  const bookings = await prisma.booking.findMany({
    where: { companyId, status: { in: ["OFFEN", "ZUGEWIESEN", "AKTIV"] } },
    include: { driver: true },
    orderBy: { createdAt: "desc" },
  });
  const scheduled = await prisma.booking.findMany({
    where: { companyId, isScheduled: true, status: { notIn: ["ABGESCHLOSSEN", "STORNIERT"] } },
    include: { driver: true },
    orderBy: { scheduledAt: "asc" },
  });
  return {
    drivers,
    bookings: bookings.map((b) => bookingDTO(b)),
    scheduled: scheduled.map((b) => bookingDTO(b)),
  };
}

// Vorbestellungen werden erst kurz vor dem Termin "live" geschaltet.
const SCHEDULED_LEAD_MS = 5 * 60_000;

async function driverState(driverId: string) {
  const me = await prisma.driver.findUnique({ where: { id: driverId } });
  // Aktueller Auftrag: Sofortfahrt ODER eine Vorbestellung, deren Termin (fast)
  // erreicht ist. Eine reservierte Vorbestellung in der Zukunft erscheint NICHT
  // als aktueller Auftrag, sondern unter "Meine geplanten Fahrten".
  const active = await prisma.booking.findFirst({
    where: {
      driverId,
      status: { in: ["ZUGEWIESEN", "AKTIV"] },
      // Nur LIVE laufende Fahrten sind der "aktuelle Auftrag" und sperren den
      // Status. Eine reservierte Vorbestellung bleibt GEPLANT (erscheint unter
      // "Meine geplanten Fahrten"), bis der Sweep sie zur Fahrtzeit live schaltet
      // – sonst würde eine (auch überfällige) geplante Fahrt den Fahrer blockieren.
      trackingStatus: { not: "GEPLANT" },
    },
    include: { driver: true },
    orderBy: { acceptedAt: "desc" },
  });
  const myScheduled = await prisma.booking.findMany({
    where: {
      driverId,
      isScheduled: true,
      status: { notIn: ["ABGESCHLOSSEN", "STORNIERT"] },
      // schon live geschaltete Vorbestellungen nicht doppelt anzeigen
      OR: [{ scheduledAt: { gt: new Date(Date.now() + SCHEDULED_LEAD_MS) } }, { trackingStatus: "GEPLANT" }],
    },
    orderBy: { scheduledAt: "asc" },
  });
  const openScheduled = await prisma.booking.findMany({
    // ADMIN-Pool-Fahrten (Krankenfahrten/Vorbestellungen der Einrichtungen)
    // erscheinen NICHT bei den Fahrern – sie werden von einer Zentrale zugewiesen.
    where: { isScheduled: true, driverId: null, status: "OFFEN", dispatchMode: "AUTO" },
    orderBy: { scheduledAt: "asc" },
  });
  return {
    status: me?.status ?? "PAUSE",
    name: me?.name ?? "",
    activeBooking: active ? bookingDTO(active) : null,
    myScheduled: myScheduled.map((b) => bookingDTO(b)),
    openScheduled: openScheduled.map((b) => bookingDTO(b)),
  };
}

export function registerSockets(io: IOServer, dispatcher: Dispatcher, realDrivers: Set<string>): void {
  // Dispatcher kann den Fahrer-State pushen (z. B. wenn eine reservierte
  // Vorbestellung fällig wird und live geschaltet werden muss).
  dispatcher.refreshDriver = async (driverId: string) => {
    try {
      io.to(`driver:${driverId}`).emit("driver:state", await driverState(driverId));
    } catch {
      /* ignore */
    }
  };

  io.on("connection", async (socket: Socket) => {
    const cookieHeader = socket.handshake.headers.cookie;
    // Rolle dieser Verbindung kommt aus dem Handshake (admin/driver/Kunde),
    // gelesen wird das jeweils passende Cookie -> Admin & Fahrer parallel möglich.
    const wantRole = (socket.handshake.auth as { role?: string } | undefined)?.role;
    const adminSession =
      wantRole === "admin"
        ? verifySession(parseCookie(cookieHeader, ADMIN_COOKIE)) ?? verifySession(parseCookie(cookieHeader, SESSION_COOKIE))
        : null;
    const driverSession =
      wantRole === "driver"
        ? verifySession(parseCookie(cookieHeader, DRIVER_COOKIE)) ?? verifySession(parseCookie(cookieHeader, SESSION_COOKIE))
        : null;

    // ---- Administrator (Firma/Mandant) ----
    if (adminSession?.role === "ADMIN") {
      const session = adminSession;
      socket.data.role = "ADMIN";
      socket.data.companyId = session.companyId;
      socket.join(`admins:${session.companyId}`);
      try {
        socket.emit("admin:snapshot", await adminSnapshot(dispatcher, session.companyId));
      } catch (e) {
        socket.emit("admin:snapshot", { drivers: [], bookings: [], scheduled: [] });
      }
    }

    // ---- Fahrer ----
    if (driverSession?.role === "DRIVER") {
      const session = driverSession;
      const driverId = session.sub;
      socket.data.role = "DRIVER";
      socket.data.driverId = driverId;
      socket.join(`driver:${driverId}`);
      socket.join("drivers");
      realDrivers.add(driverId);
      await dispatcher.onDriverConnect(driverId);
      try {
        socket.emit("driver:state", await driverState(driverId));
      } catch {
        /* ignore */
      }

      socket.on("driver:location", (p: { lat: number; lng: number }) => {
        if (typeof p?.lat === "number" && typeof p?.lng === "number") {
          dispatcher.updateLocation(driverId, p.lat, p.lng).catch(() => {});
        }
      });

      socket.on("driver:status", async (p: { status: string }, ack?: (r: any) => void) => {
        await dispatcher.setStatus(driverId, p.status).catch(() => {});
        ack?.({ ok: true });
      });

      socket.on("driver:respond", async (p: { bookingId: string; accept: boolean }, ack?: (r: any) => void) => {
        const r = await dispatcher.respondToOffer(driverId, p.bookingId, !!p.accept);
        if (r.ok) socket.emit("driver:state", await driverState(driverId));
        ack?.(r);
      });

      socket.on("driver:trip", async (p: { bookingId: string; action: any }, ack?: (r: any) => void) => {
        const r = await dispatcher.tripAction(driverId, p.bookingId, p.action);
        socket.emit("driver:state", await driverState(driverId));
        ack?.(r);
      });

      socket.on("driver:reserve", async (p: { bookingId: string }, ack?: (r: any) => void) => {
        const r = await dispatcher.reserveScheduled(driverId, p.bookingId);
        if (r.ok) socket.emit("driver:state", await driverState(driverId));
        ack?.(r);
      });

      // Zieländerung / Zwischenstopp während der Fahrt (Phase 2f).
      socket.on(
        "driver:changeDest",
        async (p: { bookingId: string; dest?: any; addStop?: any }, ack?: (r: any) => void) => {
          // Nur fuer den eigenen aktiven Auftrag.
          const b = await prisma.booking.findUnique({ where: { id: p?.bookingId } });
          if (!b || b.driverId !== driverId) {
            ack?.({ ok: false, error: "Auftrag nicht gefunden." });
            return;
          }
          const r = await dispatcher.changeDestination(p.bookingId, { dest: p.dest, addStop: p.addStop });
          if (r.ok) socket.emit("driver:state", await driverState(driverId));
          ack?.(r);
        },
      );

      socket.on("disconnect", () => {
        realDrivers.delete(driverId);
        dispatcher.onDriverDisconnect(driverId).catch(() => {});
      });
    }

    // ---- Kunde (Tracking) ----
    socket.on("track:join", async (p: { bookingId: string }, ack?: (r: any) => void) => {
      if (!p?.bookingId) return;
      socket.join(`booking:${p.bookingId}`);
      const b = await prisma.booking.findUnique({
        where: { id: p.bookingId },
        include: { driver: true },
      });
      if (b) {
        const dto = bookingDTO(b);
        socket.emit("booking:update", dto);
        ack?.({ ok: true, booking: dto });
      } else {
        ack?.({ ok: false });
      }
    });

    // ---- Chat Kunde <-> Fahrer (Phase 3i) ----
    socket.on("chat:history", async (p: { bookingId: string }, ack?: (r: any) => void) => {
      if (!p?.bookingId) return ack?.({ ok: false });
      const msgs = await prisma.chatMessage.findMany({
        where: { bookingId: p.bookingId },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      ack?.({ ok: true, messages: msgs.map(messageDTO) });
    });

    socket.on("chat:send", async (p: { bookingId: string; text: string }, ack?: (r: any) => void) => {
      const text = (p?.text ?? "").toString().trim().slice(0, 1000);
      if (!p?.bookingId || !text) return ack?.({ ok: false, error: "Leere Nachricht." });
      const b = await prisma.booking.findUnique({ where: { id: p.bookingId } });
      if (!b) return ack?.({ ok: false, error: "Auftrag nicht gefunden." });
      if (b.status === "ABGESCHLOSSEN" || b.status === "STORNIERT") {
        return ack?.({ ok: false, error: "Chat geschlossen." });
      }
      if (!b.driverId) return ack?.({ ok: false, error: "Noch kein Fahrer zugewiesen." });

      let sender: "CUSTOMER" | "DRIVER";
      if (socket.data.role === "DRIVER") {
        if (b.driverId !== socket.data.driverId) return ack?.({ ok: false, error: "Nicht berechtigt." });
        sender = "DRIVER";
      } else {
        // Kunde muss dem Tracking-Raum dieser Buchung beigetreten sein.
        if (!socket.rooms.has(`booking:${p.bookingId}`)) {
          return ack?.({ ok: false, error: "Bitte Tracking öffnen." });
        }
        sender = "CUSTOMER";
      }

      const msg = await prisma.chatMessage.create({ data: { bookingId: p.bookingId, sender, text } });
      const dto = messageDTO(msg);
      io.to(`booking:${p.bookingId}`).emit("chat:message", dto);
      io.to(`driver:${b.driverId}`).emit("chat:message", dto);
      ack?.({ ok: true, message: dto });
    });

    // ---- Admin-Aktionen ----
    socket.on("admin:cancel", async (p: { bookingId: string }) => {
      if (socket.data.role !== "ADMIN") return;
      // Mandantencheck
      const b = await prisma.booking.findUnique({ where: { id: p.bookingId } });
      if (!b || b.companyId !== socket.data.companyId) return;
      await dispatcher.cancelBooking(p.bookingId).catch(() => {});
    });

    socket.on("admin:refresh", async () => {
      if (socket.data.role !== "ADMIN" || !socket.data.companyId) return;
      socket.emit("admin:snapshot", await adminSnapshot(dispatcher, socket.data.companyId));
    });
  });
}
