// Socket.IO-Verbindungslogik. Authentifizierung erfolgt ueber das
// Session-Cookie aus dem Handshake (httpOnly, kein Token im JS noetig).

import type { Server as IOServer, Socket } from "socket.io";
import { prisma } from "../lib/prisma";
import { verifySession, SESSION_COOKIE, ADMIN_COOKIE, DRIVER_COOKIE, CUSTOMER_COOKIE } from "../lib/auth";
import type { Dispatcher } from "./dispatch";
import {
  bookingRefWhere,
  bookingRefWhereCompany,
  bookingRefWhereCustomer,
  bookingRefWhereDriver,
} from "../lib/bookingRef";
import { bookingDTO, driverAdmin, messageDTO, offeneFahrtDTO } from "./serialize";

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
    take: OFFENE_VORBESTELLUNGEN_MAX,
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

  // Deckel erreicht -> aeltere Vorbestellungen sind fuer Fahrer unsichtbar.
  // Hoechstens einmal je Stunde melden, sonst flutet es das Protokoll.
  if (openScheduled.length === OFFENE_VORBESTELLUNGEN_MAX && Date.now() - deckelGemeldet > 3_600_000) {
    deckelGemeldet = Date.now();
    console.warn(
      `Marktplatz: Obergrenze von ${OFFENE_VORBESTELLUNGEN_MAX} offenen Vorbestellungen erreicht – ` +
        "weitere sind fuer Fahrer nicht sichtbar (OPEN_SCHEDULED_MAX erhoehen).",
    );
  }

  return {
    status: me?.status ?? "PAUSE",
    name: me?.name ?? "",
    activeBooking: active ? bookingDTO(active) : null,
    // Vorgemerkte Folgefahrt (startet nach der aktuellen Fahrt automatisch).
    nextBooking: next ? bookingDTO(next) : null,
    myScheduled: myScheduled.map((b) => bookingDTO(b)),
    // Reduzierte Darstellung: die Liste geht an alle Fahrer aller Firmen,
    // auch fuer Fahrten, die noch niemand angenommen hat.
    openScheduled: openScheduled.map((b) => offeneFahrtDTO(b)),
  };
}

// Auf welche Fahrten darf diese Verbindung zugreifen?
//
// Gaeste ausschliesslich ueber den Tracking-Token. Fahrer und Firmen-Admins
// duerfen zusaetzlich die interne ID nutzen – aber nur fuer ihre eigenen
// Fahrten. Frueher galt die ID fuer JEDEN, damit konnte ein Fremder fremde
// Fahrten mitlesen und in deren Chat schreiben.
// Obergrenze der Marktplatz-Liste. Sie ist noetig (die Liste geht bei jedem
// Zustandsabruf an jeden Fahrer), aber sie darf nicht stillschweigend Fahrten
// verschlucken: wird sie erreicht, sind aeltere Vorbestellungen fuer Fahrer
// unsichtbar. Deshalb ein Hinweis im Protokoll.
const OFFENE_VORBESTELLUNGEN_MAX = Number(process.env.OPEN_SCHEDULED_MAX ?? 50);
let deckelGemeldet = 0;

function fahrtZugriff(socket: Socket, ref: string) {
  if (socket.data.role === "DRIVER") return bookingRefWhereDriver(ref, socket.data.driverId);
  if (socket.data.role === "ADMIN") return bookingRefWhereCompany(ref, socket.data.companyId);
  // Angemeldeter Fahrgast darf zusaetzlich ueber die Auftrags-ID zugreifen –
  // aber nur auf SEINE Fahrten. Gaeste weiterhin ausschliesslich per Token.
  if (socket.data.customerId) return bookingRefWhereCustomer(ref, socket.data.customerId);
  return bookingRefWhere(ref);
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
    let wantRole = (socket.handshake.auth as { role?: string } | undefined)?.role;

    // Die Rollenangabe aus dem Handshake kommt nicht immer an (beobachtet vor
    // allem bei Wiederverbindungen, die direkt als WebSocket aufgebaut werden:
    // auth={} obwohl das Cookie da ist). Ohne sie galt die Verbindung als
    // anonymer Gast – der Fahrer bekam dann NIE seinen Auftragsstand, ohne
    // Fehlermeldung und ohne dass Nachfragen geholfen haetten.
    //
    // Das Cookie allein reicht zur Bestimmung. Deshalb: fehlt die Angabe, aus
    // den vorhandenen Cookies ableiten. Ist sie da, bleibt sie massgeblich –
    // so kann ein Browser weiterhin gleichzeitig als Firma UND als Fahrer
    // verbunden sein.
    if (!wantRole) {
      if (verifySession(parseCookie(cookieHeader, DRIVER_COOKIE))) wantRole = "driver";
      else if (verifySession(parseCookie(cookieHeader, ADMIN_COOKIE))) wantRole = "admin";
    }
    const adminSession =
      wantRole === "admin"
        ? verifySession(parseCookie(cookieHeader, ADMIN_COOKIE)) ?? verifySession(parseCookie(cookieHeader, SESSION_COOKIE))
        : null;
    // Angemeldeter Fahrgast: verfolgt er seine eigene Fahrt aus dem Konto
    // heraus, nennt die Oberflaeche die Auftrags-ID statt des Link-Tokens.
    // Ohne diese Zuordnung landete er im Gast-Zweig, wo nur der Token gilt –
    // und sah dann gar keine Fahrzeugposition mehr.
    const customerSession = verifySession(parseCookie(cookieHeader, CUSTOMER_COOKIE));

    const driverSession =
      wantRole === "driver"
        ? verifySession(parseCookie(cookieHeader, DRIVER_COOKIE)) ?? verifySession(parseCookie(cookieHeader, SESSION_COOKIE))
        : null;

    // Verbindung will eine Rolle, hat aber keine gueltige Anmeldung.
    // Frueher blieb ein solcher Socket wortlos verbunden – die Oberflaeche
    // wartete dann endlos auf Daten, die nie kommen konnten.
    if (wantRole === "driver" && !driverSession) {
      console.warn(`Socket ohne gueltige Fahrer-Anmeldung (${socket.id})`);
      socket.emit("auth:required", { role: "driver", error: "Bitte erneut anmelden." });
    }
    if (wantRole === "admin" && !adminSession) {
      console.warn(`Socket ohne gueltige Admin-Anmeldung (${socket.id})`);
      socket.emit("auth:required", { role: "admin", error: "Bitte erneut anmelden." });
    }


    if (customerSession?.role === "CUSTOMER") {
      socket.data.customerId = customerSession.sub;
    }

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
      // Wirft dies, wurden frueher gar keine Handler mehr registriert: der
      // Socket war verbunden, aber vollstaendig stumm – auch auf Nachfragen.
      try {
        await dispatcher.onDriverConnect(driverId);
      } catch (e: any) {
        console.error(`onDriverConnect fehlgeschlagen (${driverId}):`, e?.message ?? e);
      }
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

      // Der Fahrer kann seinen Stand jederzeit selbst anfordern.
      //
      // Das ist die Absicherung gegen einen verlorenen Push: geht die
      // Nachricht beim Verbindungsaufbau unter (z. B. waehrend Socket.IO von
      // Polling auf WebSocket umschaltet), haette der Fahrer sonst ein ewig
      // ladendes Dashboard – ohne Fehlermeldung und ohne Wiederholung.
      socket.on("driver:sync", async (_p: unknown, ack?: (r: any) => void) => {
        try {
          const zustand = await driverState(driverId);
          socket.emit("driver:state", zustand);
          ack?.({ ok: true });
        } catch (e: any) {
          console.error(`driver:sync fehlgeschlagen (${driverId}):`, e?.message ?? e);
          socket.emit("driver:state", leererFahrerZustand());
          ack?.({ ok: false });
        }
      });

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
        where: fahrtZugriff(socket, p.bookingId),
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
      const b = await prisma.booking.findFirst({ where: fahrtZugriff(socket, p.bookingId), select: { id: true } });
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
      const b = await prisma.booking.findFirst({ where: fahrtZugriff(socket, p.bookingId) });
      if (!b) return ack?.({ ok: false, error: "Auftrag nicht gefunden." });
      if (b.status === "ABGESCHLOSSEN" || b.status === "STORNIERT") {
        return ack?.({ ok: false, error: "Chat geschlossen." });
      }
      if (!b.driverId) return ack?.({ ok: false, error: "Noch kein Fahrer zugewiesen." });

      let sender: "CUSTOMER" | "DRIVER";
      if (socket.data.role === "DRIVER") {
        if (b.driverId !== socket.data.driverId) return ack?.({ ok: false, error: "Nicht berechtigt." });
        sender = "DRIVER";
      } else if (socket.data.role === "ADMIN") {
        // Frueher fiel die Zentrale in den Kunden-Zweig und konnte im Namen
        // des Fahrgasts schreiben. Der Chat ist ausdruecklich zwischen
        // Fahrgast und Fahrer – die Zentrale hat hier keine Stimme.
        return ack?.({ ok: false, error: "Der Chat läuft zwischen Fahrgast und Fahrer." });
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
