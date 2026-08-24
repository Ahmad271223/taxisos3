// Socket.IO-Verbindungslogik. Authentifizierung erfolgt ueber das
// Session-Cookie aus dem Handshake (httpOnly, kein Token im JS noetig).

import type { Server as IOServer, Socket } from "socket.io";
import { prisma } from "../lib/prisma";
import { verifySession, SESSION_COOKIE, ADMIN_COOKIE, DRIVER_COOKIE } from "../lib/auth";
import type { Dispatcher } from "./dispatch";
import { bookingRefWhere } from "../lib/bookingRef";
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
    include: { driver: true, card: true },
    orderBy: { createdAt: "desc" },
  });
  const scheduled = await prisma.booking.findMany({
    where: { companyId, isScheduled: true, status: { notIn: ["ABGESCHLOSSEN", "STORNIERT"] } },
    include: { driver: true, card: true },
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

/** Notfall-Zustand, damit das Fahrer-Dashboard nie ohne Antwort haengen bleibt. */
function leererFahrerZustand() {
  return { status: "PAUSE", name: "", activeBooking: null, nextBooking: null, myScheduled: [], openScheduled: [] };
}

async function driverState(driverId: string) {
  // Die vier Abfragen sind unabhaengig voneinander -> parallel ausfuehren.
  // Sequenziell summieren sich die Latenzen; bei vielen gleichzeitigen
  // Verbindungen (Schichtbeginn) lief driver:state dadurch in einen Timeout.
  const mePromise = prisma.driver.findUnique({ where: { id: driverId } });
  // Aktueller Auftrag: Sofortfahrt ODER eine Vorbestellung, deren Termin (fast)
  // erreicht ist. Eine reservierte Vorbestellung in der Zukunft erscheint NICHT
  // als aktueller Auftrag, sondern unter "Meine geplanten Fahrten".
  const activePromise = prisma.booking.findFirst({
    where: {
      driverId,
      status: { in: ["ZUGEWIESEN", "AKTIV"] },
      // NUR die tatsaechlich laufende Fahrt ist der "aktuelle Auftrag".
      // Bewusst ausgeschlossen:
      //  - GEPLANT            -> reservierte Vorbestellung ("Meine geplanten Fahrten")
      //  - RESERVIERT_FAHRER  -> vorgemerkte FOLGEfahrt; sie wurde spaeter
      //    angenommen und wuerde die laufende Fahrt aus der Sortierung
      //    verdraengen. Im UI sind fuer diesen Status alle Trip-Buttons
      //    gesperrt -> das Dashboard waere blockiert.
      trackingStatus: { in: ["FAHRER_GEFUNDEN", "FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT"] },
      // Zusaetzliche Absicherung: eine Vorbestellung, deren Fahrtzeit noch in
      // der Zukunft liegt, ist NIE der aktuelle Auftrag.
      NOT: { isScheduled: true, scheduledAt: { gt: new Date(Date.now() + SCHEDULED_LEAD_MS) } },
    },
    include: { driver: true, card: true },
    // acceptedAt kann null sein (z. B. vorgemerkte Fahrten); Postgres sortiert
    // bei DESC sonst NULLS FIRST und eine Fahrt ohne Zeitstempel wuerde die
    // echte, gerade angenommene Fahrt verdraengen.
    orderBy: [{ acceptedAt: { sort: "desc", nulls: "last" } }],
  });
  const myScheduledPromise = prisma.booking.findMany({
    where: {
      driverId,
      isScheduled: true,
      status: { notIn: ["ABGESCHLOSSEN", "STORNIERT"] },
      // schon live geschaltete Vorbestellungen nicht doppelt anzeigen
      OR: [{ scheduledAt: { gt: new Date(Date.now() + SCHEDULED_LEAD_MS) } }, { trackingStatus: "GEPLANT" }],
    },
    orderBy: { scheduledAt: "asc" },
  });
  const openScheduledPromise = prisma.booking.findMany({
    // ADMIN-Pool-Fahrten (Krankenfahrten/Vorbestellungen der Einrichtungen)
    // erscheinen NICHT bei den Fahrern – sie werden von einer Zentrale zugewiesen.
    where: { isScheduled: true, driverId: null, status: "OFFEN", dispatchMode: "AUTO" },
    orderBy: { scheduledAt: "asc" },
    take: 50,
  });
  // Vorgemerkte Folgefahrt: waehrend der laufenden Fahrt angenommen, startet
  // automatisch nach deren Abschluss. Wird separat ausgewiesen, damit sie den
  // aktuellen Auftrag nicht verdeckt.
  const nextPromise = prisma.booking.findFirst({
    where: { driverId, status: "ZUGEWIESEN", trackingStatus: "RESERVIERT_FAHRER" },
    include: { driver: true, card: true },
    orderBy: [{ acceptedAt: { sort: "desc", nulls: "last" } }],
  });

  const [me, active, myScheduled, openScheduled, next] = await Promise.all([
    mePromise,
    activePromise,
    myScheduledPromise,
    openScheduledPromise,
    nextPromise,
  ]);

  return {
    status: me?.status ?? "PAUSE",
    name: me?.name ?? "",
    activeBooking: active ? bookingDTO(active) : null,
    // Vorgemerkte Folgefahrt (startet nach der aktuellen Fahrt automatisch).
    nextBooking: next ? bookingDTO(next) : null,
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

  // Allen verbundenen Fahrern einen frischen Stand schicken – z. B. wenn eine
  // Vorbestellung nach einer Fahrer-Absage wieder in den Pool zurueckkehrt.
  dispatcher.refreshAllDrivers = async () => {
    try {
      const room = io.sockets.adapter.rooms.get("drivers");
      if (!room) return;
      for (const socketId of room) {
        const s = io.sockets.sockets.get(socketId);
        const did = s?.data?.driverId;
        if (did) s!.emit("driver:state", await driverState(did));
      }
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
      // WICHTIG: Ein Fehler wurde hier frueher stillschweigend verschluckt –
      // der Fahrer bekam dann GAR NICHTS, sein Dashboard drehte sich endlos,
      // ohne Meldung und ohne Wiederholung. Deshalb jetzt: Fehler
      // protokollieren UND trotzdem einen brauchbaren Zustand schicken.
      try {
        socket.emit("driver:state", await driverState(driverId));
      } catch (e: any) {
        console.error(`driver:state fehlgeschlagen (${driverId}):`, e?.message ?? e);
        socket.emit("driver:state", leererFahrerZustand());
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

      // Antwort auf die 30-Min-Rueckfrage ("Fahrt weiterhin durchfuehren?").
      // keep=true  -> Fahrt bleibt beim Fahrer.
      // keep=false -> im UI erscheint der Button "Fahrt stornieren".
      socket.on(
        "driver:confirmScheduled",
        async (p: { bookingId: string; keep: boolean }, ack?: (r: any) => void) => {
          const r = await dispatcher.respondScheduledConfirm(driverId, p?.bookingId, !!p?.keep);
          if (r.ok) socket.emit("driver:state", await driverState(driverId));
          ack?.(r);
        },
      );

      // Endgueltige Absage: Fahrt freigeben, Kunde per SMS informieren,
      // sofort neuen Fahrer suchen.
      socket.on("driver:cancelScheduled", async (p: { bookingId: string }, ack?: (r: any) => void) => {
        const r = await dispatcher.releaseScheduledByDriver(driverId, p?.bookingId);
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
    // WICHTIG: Gaeste oeffnen /verfolgen/<trackingToken>, senden also den Token
    // als Referenz. Der Dispatcher sendet aber an `booking:<id>`. Der Raum muss
    // daher IMMER unter der kanonischen Buchungs-ID betreten werden – sonst
    // erhaelt der Gast keine Live-Updates und kann nicht chatten.
    socket.on("track:join", async (p: { bookingId: string }, ack?: (r: any) => void) => {
      if (!p?.bookingId) return ack?.({ ok: false });
      const b = await prisma.booking.findFirst({
        where: bookingRefWhere(p.bookingId),
        include: { driver: true, card: true },
      });
      if (!b) return ack?.({ ok: false });
      socket.join(`booking:${b.id}`);
      const dto = bookingDTO(b);
      socket.emit("booking:update", dto);
      ack?.({ ok: true, booking: dto });
    });

    // ---- Chat Kunde <-> Fahrer (Phase 3i) ----
    socket.on("chat:history", async (p: { bookingId: string }, ack?: (r: any) => void) => {
      if (!p?.bookingId) return ack?.({ ok: false });
      const b = await prisma.booking.findFirst({ where: bookingRefWhere(p.bookingId), select: { id: true } });
      if (!b) return ack?.({ ok: false });
      const msgs = await prisma.chatMessage.findMany({
        where: { bookingId: b.id },
        orderBy: { createdAt: "asc" },
        take: 100,
      });
      ack?.({ ok: true, messages: msgs.map(messageDTO) });
    });

    socket.on("chat:send", async (p: { bookingId: string; text: string }, ack?: (r: any) => void) => {
      const text = (p?.text ?? "").toString().trim().slice(0, 1000);
      if (!p?.bookingId || !text) return ack?.({ ok: false, error: "Leere Nachricht." });
      const b = await prisma.booking.findFirst({ where: bookingRefWhere(p.bookingId) });
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
        // Kunde muss dem Tracking-Raum dieser Buchung beigetreten sein
        // (Raumname ist immer die kanonische Buchungs-ID, siehe track:join).
        if (!socket.rooms.has(`booking:${b.id}`)) {
          return ack?.({ ok: false, error: "Bitte Tracking öffnen." });
        }
        sender = "CUSTOMER";
      }

      const msg = await prisma.chatMessage.create({ data: { bookingId: b.id, sender, text } });
      const dto = messageDTO(msg);
      io.to(`booking:${b.id}`).emit("chat:message", dto);
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
