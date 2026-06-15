// Dispatch-Engine: Plattform-weite GPS-Auto-Disposition mit
// Radius-Erweiterung (Bolt-Style).
//
// Ablauf:
//  1. Sofortbuchung -> assignNext()
//  2. Aktuelle Phase (z. B. 500 m). Alle ONLINE + FREI Fahrer im Umkreis (firmenuebergreifend)
//     erhalten die Anfrage. Wer zuerst annimmt, bekommt die Fahrt; alle anderen
//     erhalten "Anfrage vergeben".
//  3. Niemand nimmt innerhalb der Phasendauer (15 s) an -> Radius erweitern.
//  4. Stufen: 500 m -> 1 km -> 2 km -> 3 km -> 5 km. Danach bleibt der Auftrag OFFEN
//     und wird vom Sweep periodisch erneut versucht.
//
// Fahrerstatus (intern):
//  ONLINE - FREI         -> erhaelt Anfragen
//  ONLINE - BESETZT      -> erhaelt keine; AUSSER er ist <300 m vom Ziel ("near completion")
//  ONLINE - PAUSE        -> keine Anfragen
//  OFFLINE               -> keine Anfragen

import type { Server as IOServer } from "socket.io";
import { prisma } from "../lib/prisma";
import { haversineMeters, routeBetween, estimatePriceViaWith, type GeoPoint } from "../lib/geo";
import { pricingForSlug, classFactorForCompanyId, applyClassFactor } from "../lib/pricing";
import { normalizeClass } from "../lib/vehicleClasses";
import { computeCommission } from "../lib/commission";
import { bookingRoutePoints, parseStops, serializeStops, type Stop } from "../lib/stops";
import { capturePayment, voidPayment } from "../lib/stripe";
import { bookingDTO, driverAdmin } from "./serialize";

const PHASE_DURATION_MS = 15_000;
const PHASES_METERS = [500, 1000, 2000, 3000, 5000];
// Maximale Dauer der Fahrersuche je Sofortbuchung (ab Suchbeginn). Danach wird
// die Suche endgültig beendet (trackingStatus KEIN_FAHRER) und nicht erneut versucht.
// Über SEARCH_MAX_MS (env) für Tests verkürzbar; Standard 180 s.
const SEARCH_MAX_MS = Number(process.env.SEARCH_MAX_MS ?? 180_000);
const NEAR_COMPLETION_METERS = 300;
const SCHEDULED_LEAD_MS = 5 * 60_000;
const LOCATION_PERSIST_MS = 8_000;

interface LiveDriver {
  id: string;
  companyId: string;
  name: string;
  status: string; // FREI | BESETZT | PAUSE | OFFLINE
  vehicleClass: string; // Fahrzeugklasse (Phase 12 Marktplatz)
  medicalAllowed: boolean; // Krankenfahrten-Freigabe (Phase 15)
  hasRamp: boolean; // Rollstuhlrampe/Lift (Phase D)
  hasStretcher: boolean; // Tragestuhl (Phase D)
  lat: number | null;
  lng: number | null;
  online: boolean;
  lastSeen: number;
}

interface ActiveDispatch {
  bookingId: string;
  phaseIndex: number;
  notifiedDriverIds: Set<string>;
  pendingDriverIds: Set<string>;
  timer: NodeJS.Timeout;
  phaseEndsAt: number;
}

function csvToSet(csv: string | null | undefined): Set<string> {
  if (!csv) return new Set();
  return new Set(csv.split(",").map((s) => s.trim()).filter(Boolean));
}

export class Dispatcher {
  private io: IOServer;
  private live = new Map<string, LiveDriver>();
  private dispatches = new Map<string, ActiveDispatch>(); // key = bookingId
  private driverActiveBooking = new Map<string, string>();
  private driverActiveBookingDest = new Map<string, { lat: number; lng: number }>();
  private driverNearCompletion = new Set<string>();
  // Reservierung der naechsten Fahrt (Bolt-Style near completion)
  private driverReservedBooking = new Map<string, string>();
  private lastPersist = new Map<string, number>();

  // Hook fuer den GPS-Simulator (virtuelle Fahrer): wird je Empfaenger gerufen.
  public onOffer?: (bookingId: string, driverId: string) => void;
  // Hook (von realtime gesetzt): pusht den Fahrer-State neu, z. B. wenn eine
  // reservierte Vorbestellung faellig wird.
  public refreshDriver?: (driverId: string) => void | Promise<void>;

  constructor(io: IOServer) {
    this.io = io;
  }

  // -- Initialisierung -----------------------------------------------------
  async init(): Promise<void> {
    const drivers = await prisma.driver.findMany();
    for (const d of drivers) {
      this.live.set(d.id, {
        id: d.id,
        companyId: d.companyId,
        name: d.name,
        status: "OFFLINE",
        vehicleClass: normalizeClass(d.vehicleClass),
        medicalAllowed: d.medicalAllowed ?? false,
        hasRamp: d.hasRamp ?? false,
        hasStretcher: d.hasStretcher ?? false,
        lat: d.lat ?? null,
        lng: d.lng ?? null,
        online: false,
        lastSeen: 0,
      });
      await prisma.driver.update({ where: { id: d.id }, data: { status: "OFFLINE" } });
    }
    const active = await prisma.booking.findMany({
      where: { status: { in: ["ZUGEWIESEN", "AKTIV"] }, driverId: { not: null } },
    });
    for (const b of active) {
      if (b.driverId) {
        this.driverActiveBooking.set(b.driverId, b.id);
        this.driverActiveBookingDest.set(b.driverId, { lat: b.destLat, lng: b.destLng });
      }
    }

    setInterval(() => this.sweep().catch(() => {}), 20_000);
  }

  // -- Helfer --------------------------------------------------------------
  private emitAdminDriver(driver: any) {
    if (driver?.companyId) {
      this.io.to(`admins:${driver.companyId}`).emit("admin:driver", driverAdmin(driver));
    }
  }

  // Öffentlicher Hook (z. B. Flug-Verspätungs-Scheduler): pusht ein aktualisiertes
  // Buchungs-DTO an Kunde/Admin/Fahrer.
  public async refreshBooking(bookingId: string): Promise<void> {
    await this.emitBooking(bookingId);
  }

  private async emitBooking(bookingId: string, event = "booking:update") {
    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { driver: true },
    });
    if (!b) return;
    const eta = this.driverActiveBooking.get(b.driverId ?? "") === b.id
      ? await this.etaSeconds(b)
      : null;
    const dto = bookingDTO(b, { etaSeconds: eta });
    this.io.to(`booking:${bookingId}`).emit(event, dto);
    if (b.companyId) {
      this.io.to(`admins:${b.companyId}`).emit("admin:booking", dto);
    }
    if (b.driverId) {
      this.io.to(`driver:${b.driverId}`).emit("driver:booking", dto);
    }
    return dto;
  }

  private async etaSeconds(b: any): Promise<number | null> {
    const d = this.live.get(b.driverId);
    if (!d || d.lat == null || d.lng == null) return null;
    try {
      const r = await routeBetween({ lat: d.lat, lng: d.lng }, { lat: b.pickupLat, lng: b.pickupLng });
      return r.durationSeconds;
    } catch {
      return null;
    }
  }

  // -- Fahrer-Lebenszyklus -------------------------------------------------
  async onDriverConnect(driverId: string): Promise<void> {
    const d = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!d) return;
    const prev = this.live.get(driverId);
    const status = prev && prev.status !== "OFFLINE" ? prev.status : "PAUSE";
    this.live.set(driverId, {
      id: d.id,
      companyId: d.companyId,
      name: d.name,
      status,
      vehicleClass: normalizeClass(d.vehicleClass),
      medicalAllowed: d.medicalAllowed ?? false,
      hasRamp: d.hasRamp ?? false,
      hasStretcher: d.hasStretcher ?? false,
      lat: d.lat ?? prev?.lat ?? null,
      lng: d.lng ?? prev?.lng ?? null,
      online: true,
      lastSeen: Date.now(),
    });
    const updated = await prisma.driver.update({
      where: { id: driverId },
      data: { status, lastSeenAt: new Date() },
    });
    this.emitAdminDriver(updated);
  }

  async onDriverDisconnect(driverId: string): Promise<void> {
    const live = this.live.get(driverId);
    if (live) {
      live.online = false;
      live.status = "OFFLINE";
    }
    this.driverNearCompletion.delete(driverId);
    // Aus allen Pending-Listen entfernen.
    for (const [bid, disp] of this.dispatches) {
      if (disp.pendingDriverIds.has(driverId)) {
        disp.pendingDriverIds.delete(driverId);
        this.io.to(`driver:${driverId}`).emit("driver:offerCancel", { bookingId: bid });
      }
    }
    try {
      const updated = await prisma.driver.update({
        where: { id: driverId },
        data: { status: "OFFLINE", lastSeenAt: new Date() },
      });
      this.emitAdminDriver(updated);
    } catch {
      /* ignore */
    }
  }

  async updateLocation(driverId: string, lat: number, lng: number): Promise<void> {
    let live = this.live.get(driverId);
    if (live) {
      live.lat = lat;
      live.lng = lng;
      live.lastSeen = Date.now();
      live.online = true;
    } else {
      live = {
        id: driverId,
        companyId: "",
        name: "",
        status: "PAUSE",
        vehicleClass: "STANDARD",
        medicalAllowed: false,
        hasRamp: false,
        hasStretcher: false,
        lat,
        lng,
        online: true,
        lastSeen: Date.now(),
      };
      this.live.set(driverId, live);
    }

    if (live.companyId) {
      this.io.to(`admins:${live.companyId}`).emit("admin:driverLocation", { id: driverId, lat, lng });
    }

    const activeBooking = this.driverActiveBooking.get(driverId);
    if (activeBooking) {
      this.io.to(`booking:${activeBooking}`).emit("booking:driverLocation", {
        bookingId: activeBooking,
        lat,
        lng,
      });

      // Near-Completion-Check: <300 m vom Ziel -> wieder fuer Anfragen freischalten.
      const dest = this.driverActiveBookingDest.get(driverId);
      if (dest) {
        const distToDest = haversineMeters({ lat, lng }, dest);
        if (distToDest < NEAR_COMPLETION_METERS && !this.driverNearCompletion.has(driverId)) {
          this.driverNearCompletion.add(driverId);
          // Bei naechstem Sweep wird er als Kandidat beruecksichtigt.
          this.tryAssignPending().catch(() => {});
        }
      }
    }

    const last = this.lastPersist.get(driverId) ?? 0;
    if (Date.now() - last > LOCATION_PERSIST_MS) {
      this.lastPersist.set(driverId, Date.now());
      prisma.driver
        .update({ where: { id: driverId }, data: { lat, lng, lastSeenAt: new Date() } })
        .catch(() => {});
    }
  }

  async setStatus(driverId: string, status: string): Promise<void> {
    const live = this.live.get(driverId);
    if (live) live.status = status;
    const updated = await prisma.driver.update({
      where: { id: driverId },
      data: { status, lastSeenAt: new Date() },
    });
    this.emitAdminDriver(updated);
    if (status === "FREI") {
      this.driverNearCompletion.delete(driverId);
      this.tryAssignPending().catch(() => {});
    }
  }

  getLiveDrivers() {
    return Array.from(this.live.values());
  }

  // -- Disposition mit Radius-Erweiterung ---------------------------------
  async dispatchBooking(bookingId: string): Promise<void> {
    await this.startOrContinueDispatch(bookingId, 0);
  }

  private async startOrContinueDispatch(bookingId: string, phaseIndex: number): Promise<void> {
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b) return;
    if (b.status !== "OFFEN") return;

    // Harte Obergrenze (180 s): Suche endgültig beenden, nicht weiter versuchen.
    const searchStartedAt = (b.assignedAt ?? b.createdAt).getTime();
    if (!b.isScheduled && Date.now() - searchStartedAt > SEARCH_MAX_MS) {
      const prev = this.dispatches.get(bookingId);
      if (prev) {
        clearTimeout(prev.timer);
        for (const did of prev.pendingDriverIds) this.io.to(`driver:${did}`).emit("driver:offerCancel", { bookingId });
      }
      this.dispatches.delete(bookingId);
      if (b.trackingStatus !== "KEIN_FAHRER") {
        await prisma.booking.update({ where: { id: bookingId }, data: { trackingStatus: "KEIN_FAHRER" } });
        await this.emitBooking(bookingId);
      }
      return;
    }

    if (phaseIndex >= PHASES_METERS.length) {
      // Alle Phasen durchlaufen: kein freier Fahrer.
      this.dispatches.delete(bookingId);
      if (b.trackingStatus !== "KEIN_FAHRER") {
        await prisma.booking.update({
          where: { id: bookingId },
          data: { trackingStatus: "KEIN_FAHRER" },
        });
        await this.emitBooking(bookingId);
      }
      return;
    }

    const radius = PHASES_METERS[phaseIndex];
    const declined = csvToSet(b.declinedDriverIds);
    const previous = this.dispatches.get(bookingId);
    const already = previous?.notifiedDriverIds ?? new Set<string>();

    const pickup = { lat: b.pickupLat, lng: b.pickupLng };
    const wantClass = normalizeClass(b.vehicleClass);
    // Krankenfahrt (Phase 15): nur fuer Krankenfahrten freigegebene Fahrer
    // duerfen ein Angebot erhalten. Ist keiner freigegeben, bleibt der Auftrag
    // in SUCHE und laeuft nach SEARCH_MAX_MS in KEIN_FAHRER (sicheres Haengen).
    const needsMedical = !!b.medicalType;
    // Fahrzeug-Anforderungen (Phase D): Rampe/Tragestuhl zusaetzlich erzwingen.
    const needsRamp = !!b.requiresRamp;
    const needsStretcher = !!b.requiresStretcher;

    // Kandidaten: ONLINE + FREI ODER (BESETZT + nahe Ziel) und im Radius.
    // Nur Fahrer der angefragten Fahrzeugklasse erhalten ein Angebot (Marktplatz).
    let candidates = this.getLiveDrivers()
      .filter((d) => d.online && d.lat != null && d.lng != null && !declined.has(d.id))
      .filter((d) => normalizeClass(d.vehicleClass) === wantClass)
      .filter((d) => !needsMedical || d.medicalAllowed)
      .filter((d) => !needsRamp || d.hasRamp)
      .filter((d) => !needsStretcher || d.hasStretcher)
      .filter(
        (d) =>
          d.status === "FREI" ||
          (d.status === "BESETZT" && this.driverNearCompletion.has(d.id)),
      )
      .map((d) => ({ d, dist: haversineMeters(pickup, { lat: d.lat!, lng: d.lng! }) }))
      .filter((c) => c.dist <= radius && !already.has(c.d.id))
      .sort((a, b2) => a.dist - b2.dist);

    // Gezielte Einzelbestellung (Live-Karte): in Phase 0 NUR das gewählte Taxi
    // anfragen (ohne Radius-/Klassenfilter – der Kunde hat es selbst gewählt).
    // Ist es nicht (mehr) frei verfügbar, Markierung löschen und normal weiter.
    if (phaseIndex === 0 && b.requestedDriverId) {
      const td = this.getLiveDrivers().find(
        (d) => d.id === b.requestedDriverId && d.online && d.lat != null && d.lng != null && d.status === "FREI" && !declined.has(d.id) && (!needsMedical || d.medicalAllowed) && (!needsRamp || d.hasRamp) && (!needsStretcher || d.hasStretcher),
      );
      if (td) {
        candidates = [{ d: td, dist: haversineMeters(pickup, { lat: td.lat!, lng: td.lng! }) }];
      } else {
        await prisma.booking.update({ where: { id: bookingId }, data: { requestedDriverId: null } }).catch(() => {});
      }
    }

    if (candidates.length === 0) {
      // Phase ohne Kandidaten: direkt zur naechsten Phase.
      if (previous) clearTimeout(previous.timer);
      const timer = setTimeout(
        () => this.startOrContinueDispatch(bookingId, phaseIndex + 1).catch(() => {}),
        PHASE_DURATION_MS,
      );
      this.dispatches.set(bookingId, {
        bookingId,
        phaseIndex,
        notifiedDriverIds: already,
        pendingDriverIds: new Set(),
        timer,
        phaseEndsAt: Date.now() + PHASE_DURATION_MS,
      });
      if (b.trackingStatus !== "SUCHE") {
        await prisma.booking.update({
          where: { id: bookingId },
          data: { trackingStatus: "SUCHE", assignedAt: b.assignedAt ?? new Date() },
        });
        await this.emitBooking(bookingId);
      }
      return;
    }

    // Diese Phase: alle Kandidaten gleichzeitig benachrichtigen.
    const phaseEndsAt = Date.now() + PHASE_DURATION_MS;
    const pending = new Set<string>();
    const notified = new Set(already);
    for (const c of candidates) {
      notified.add(c.d.id);
      pending.add(c.d.id);
    }

    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(
      () => this.onPhaseTimeout(bookingId).catch(() => {}),
      PHASE_DURATION_MS,
    );
    this.dispatches.set(bookingId, {
      bookingId,
      phaseIndex,
      notifiedDriverIds: notified,
      pendingDriverIds: pending,
      timer,
      phaseEndsAt,
    });

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: { trackingStatus: "SUCHE", assignedAt: b.assignedAt ?? new Date() },
      include: { driver: true },
    });

    // Jedem Kandidaten ein Angebot zustellen.
    for (const c of candidates) {
      const dto = bookingDTO(updated, {
        etaSeconds: null,
        offerExpiresAt: phaseEndsAt,
        offerDurationMs: PHASE_DURATION_MS,
        distanceToPickup: Math.round(c.dist),
      });
      this.io.to(`driver:${c.d.id}`).emit("driver:offer", dto);
      this.onOffer?.(bookingId, c.d.id);
    }

    await this.emitBooking(bookingId);
  }

  private async onPhaseTimeout(bookingId: string): Promise<void> {
    const disp = this.dispatches.get(bookingId);
    if (!disp) return;
    // Allen Pending mitteilen, dass die Anfrage abgelaufen ist.
    for (const did of disp.pendingDriverIds) {
      this.io.to(`driver:${did}`).emit("driver:offerCancel", { bookingId });
    }
    // Gezielte Einzelanfrage (Phase 0) abgelaufen -> Markierung lösen, danach
    // wird breit an alle Fahrer der Klasse disponiert.
    if (disp.phaseIndex === 0) {
      await prisma.booking.update({ where: { id: bookingId }, data: { requestedDriverId: null } }).catch(() => {});
    }
    // Pending leeren, dann naechste Radius-Phase starten.
    await this.startOrContinueDispatch(bookingId, disp.phaseIndex + 1);
  }

  async respondToOffer(driverId: string, bookingId: string, accept: boolean): Promise<{ ok: boolean; reason?: string }> {
    const disp = this.dispatches.get(bookingId);
    if (!disp || !disp.pendingDriverIds.has(driverId)) {
      return { ok: false, reason: "Anfrage nicht mehr gueltig." };
    }
    if (!accept) {
      // Diesen Fahrer aus der Pending-Liste entfernen.
      disp.pendingDriverIds.delete(driverId);
      await this.addDeclined(bookingId, driverId);
      // Wenn keiner uebrig: warten bis Phasen-Timeout.
      return { ok: true };
    }

    // Annahme: erster gewinnt.
    clearTimeout(disp.timer);
    this.dispatches.delete(bookingId);
    // Allen anderen "vergeben" signalisieren.
    for (const did of disp.pendingDriverIds) {
      if (did !== driverId) {
        this.io.to(`driver:${did}`).emit("driver:offerCancel", { bookingId });
      }
    }
    // Dieser Fahrer ist jetzt vergeben: aus ALLEN anderen offenen Dispatches
    // entfernen (z. B. parallele Fahrzeuge einer Gruppenbuchung), damit eine
    // Gruppe auf verschiedene Fahrer verteilt wird.
    this.removeDriverFromOtherDispatches(driverId, bookingId);
    await this.acceptBooking(bookingId, driverId);
    return { ok: true };
  }

  // Entfernt einen (gerade vergebenen) Fahrer aus allen anderen aktiven
  // Dispatch-Pending-Listen und sagt ihm dort das Angebot ab.
  private removeDriverFromOtherDispatches(driverId: string, exceptBookingId: string): void {
    for (const [bid, disp] of this.dispatches) {
      if (bid === exceptBookingId) continue;
      if (disp.pendingDriverIds.delete(driverId)) {
        this.io.to(`driver:${driverId}`).emit("driver:offerCancel", { bookingId: bid });
      }
    }
  }

  private async addDeclined(bookingId: string, driverId: string): Promise<void> {
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b) return;
    const set = csvToSet(b.declinedDriverIds);
    set.add(driverId);
    await prisma.booking.update({
      where: { id: bookingId },
      data: { declinedDriverIds: Array.from(set).join(",") },
    });
  }

  private async acceptBooking(bookingId: string, driverId: string): Promise<void> {
    const live = this.live.get(driverId);
    const now = new Date();
    // Reservierung? -> Fahrer ist noch BESETZT mit aktueller Fahrt
    const isReservation = live?.status === "BESETZT" || this.driverActiveBooking.has(driverId);

    // Exakten Endpreis via Routenberechnung + Firmen-Tarif ermitteln.
    // Mehrziel: Gesamtstrecke ueber Abholung -> Stopps -> Ziel (Phase 2e).
    const b0 = await prisma.booking.findUnique({ where: { id: bookingId } });
    let priceExact: number | null = null;
    try {
      if (b0) {
        // companyId wird gleich auf live.companyId gesetzt - dafuer Tarif holen.
        const company = live?.companyId
          ? await prisma.company.findUnique({ where: { id: live.companyId }, select: { slug: true } })
          : null;
        const pricing = await pricingForSlug(company?.slug);
        const est = await estimatePriceViaWith(bookingRoutePoints(b0), pricing);
        // Klassenfaktor der annehmenden Firma anwenden (Phase 12 Marktplatz).
        const factor = await classFactorForCompanyId(live?.companyId, normalizeClass(b0.vehicleClass));
        // Mittelwert der Spanne als Festpreis (priceMin/priceMax bilden +/- 12%-Korridor).
        priceExact = applyClassFactor((est.priceMin + est.priceMax) / 2, factor);
      }
    } catch {
      /* fallback: priceExact bleibt null, wird bei complete neu berechnet */
    }

    const trackingStatus = isReservation ? "RESERVIERT_FAHRER" : "FAHRER_UNTERWEGS";

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: "ZUGEWIESEN",
        trackingStatus,
        driverId,
        companyId: live?.companyId ?? undefined,
        acceptedAt: now,
        priceExact,
        isReserved: isReservation,
      },
      include: { driver: true },
    });

    if (isReservation) {
      // Reservierte Folgefahrt: aktuelle Fahrt laeuft weiter,
      // Fahrer wird auf RESERVIERT gesetzt, neuer Auftrag wartet.
      this.driverReservedBooking.set(driverId, bookingId);
      await this.setStatusInternal(driverId, "RESERVIERT");
    } else {
      this.driverActiveBooking.set(driverId, bookingId);
      this.driverActiveBookingDest.set(driverId, { lat: updated.destLat, lng: updated.destLng });
      this.driverNearCompletion.delete(driverId);
      await this.setStatusInternal(driverId, "BESETZT");
    }
    await this.emitBooking(bookingId);
  }

  // -- Notfall-Rettungsfahrt (Phase 21) -----------------------------------
  // SOS: ordnet den NÄCHSTGELEGENEN freien Fahrer SOFORT (ohne Auktion) der
  // Notfallfahrt zu und schickt ihn direkt zum SOS-Standort. Kein freier Fahrer
  // -> normale Radius-Dispatch als Fallback.
  async dispatchSosRescue(
    bookingId: string,
  ): Promise<{ ok: boolean; driver?: { id: string; name: string | null; phone: string | null; vehiclePlate: string | null }; etaSeconds?: number | null }> {
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b || b.status !== "OFFEN") return { ok: false };

    const pickup = { lat: b.pickupLat, lng: b.pickupLng };
    const nearest = this.getLiveDrivers()
      .filter((d) => d.online && d.status === "FREI" && d.lat != null && d.lng != null)
      .map((d) => ({ d, dist: haversineMeters(pickup, { lat: d.lat!, lng: d.lng! }) }))
      .sort((a, c) => a.dist - c.dist)[0];

    if (!nearest) {
      // Kein freier Fahrer sofort verfügbar -> normaler (dringender) Dispatch.
      await this.startOrContinueDispatch(bookingId, 0);
      return { ok: false };
    }

    const driverId = nearest.d.id;
    const live = this.live.get(driverId);
    const now = new Date();
    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: "ZUGEWIESEN",
        trackingStatus: "FAHRER_UNTERWEGS",
        driverId,
        companyId: live?.companyId ?? undefined,
        assignedAt: now,
        acceptedAt: now,
      },
      include: { driver: true },
    });

    this.driverActiveBooking.set(driverId, bookingId);
    this.driverActiveBookingDest.set(driverId, { lat: updated.destLat, lng: updated.destLng });
    this.driverNearCompletion.delete(driverId);
    await this.setStatusInternal(driverId, "BESETZT");
    // Falls der Fahrer noch in anderen Angeboten hing: dort entfernen.
    this.removeDriverFromOtherDispatches(driverId, bookingId);

    // Notfall-Signal an den Fahrer (auffällige Anzeige) + normales Booking-Update.
    const dto = bookingDTO(updated);
    this.io.to(`driver:${driverId}`).emit("driver:emergency", dto);
    const etaSeconds = await this.etaSeconds(updated);
    await this.emitBooking(bookingId);

    return {
      ok: true,
      etaSeconds,
      driver: {
        id: updated.driver?.id ?? driverId,
        name: updated.driver?.name ?? null,
        phone: updated.driver?.phone ?? null,
        vehiclePlate: updated.driver?.vehiclePlate ?? null,
      },
    };
  }

  private async setStatusInternal(driverId: string, status: string): Promise<void> {
    const live = this.live.get(driverId);
    if (live) live.status = status;
    const updated = await prisma.driver.update({
      where: { id: driverId },
      data: { status, lastSeenAt: new Date() },
    });
    this.emitAdminDriver(updated);
  }

  // -- Fahrtfortschritt ----------------------------------------------------
  async tripAction(driverId: string, bookingId: string, action: "arrived" | "start" | "complete" | "cancel"): Promise<{ ok: boolean }> {
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b || b.driverId !== driverId) return { ok: false };

    if (action === "arrived") {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { trackingStatus: "FAHRER_ANGEKOMMEN", arrivedAt: new Date() },
      });
    } else if (action === "start") {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: "AKTIV", trackingStatus: "FAHRT_LAEUFT", startedAt: new Date() },
      });
    } else if (action === "complete") {
      // Endpreis: priceExact (nach Annahme festgelegt) > priceMax > priceMin
      const fare = b.priceExact ?? b.priceMax ?? b.priceMin ?? 0;
      // Provision basierend auf Firma (Tier) berechnen.
      let platformFeeRate: number | null = null;
      let platformFee: number | null = null;
      let companyNet: number | null = null;
      if (fare > 0) {
        const company = b.companyId
          ? await prisma.company.findUnique({ where: { id: b.companyId }, select: { cityTier: true } })
          : null;
        const c = computeCommission(fare, company?.cityTier);
        platformFeeRate = c.rate;
        platformFee = c.platformFee;
        companyNet = c.companyNet;
      }

      // Karte belasten (Phase 2g): exakten Fahrpreis vom Hold abbuchen.
      // Capture darf den autorisierten Betrag nicht uebersteigen -> deckeln.
      let paymentStatus = b.paymentStatus;
      if (b.paymentMethod === "CARD" && b.paymentStatus === "AUTORISIERT") {
        const captureAmount = b.priceAuthorized != null ? Math.min(fare, b.priceAuthorized) : fare;
        const cap = await capturePayment(b.paymentRef, captureAmount);
        paymentStatus = cap.status; // BEZAHLT | FEHLGESCHLAGEN
      }

      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "ABGESCHLOSSEN",
          trackingStatus: "BEENDET",
          completedAt: new Date(),
          fare,
          platformFeeRate,
          platformFee,
          companyNet,
          paymentStatus,
        },
      });
      this.driverActiveBooking.delete(driverId);
      this.driverActiveBookingDest.delete(driverId);
      this.driverNearCompletion.delete(driverId);

      // Bonus-/Punktesystem (Phase 18): 1 Punkt je vollem Euro Fahrpreis.
      if (b.customerId && fare > 0) {
        await prisma.customer
          .update({ where: { id: b.customerId }, data: { points: { increment: Math.max(1, Math.round(fare)) } } })
          .catch(() => {});
      }

      // Reservierte Folgefahrt automatisch starten?
      const reservedId = this.driverReservedBooking.get(driverId);
      if (reservedId) {
        this.driverReservedBooking.delete(driverId);
        const reserved = await prisma.booking.update({
          where: { id: reservedId },
          data: {
            trackingStatus: "FAHRER_UNTERWEGS",
            isReserved: false,
          },
          include: { driver: true },
        });
        this.driverActiveBooking.set(driverId, reservedId);
        this.driverActiveBookingDest.set(driverId, { lat: reserved.destLat, lng: reserved.destLng });
        await this.setStatusInternal(driverId, "BESETZT");
        await this.emitBooking(reservedId);
      } else {
        await this.setStatus(driverId, "FREI");
      }
    } else if (action === "cancel") {
      // Karten-Autorisierung wieder freigeben (Phase 2g).
      let paymentStatus = b.paymentStatus;
      if (b.paymentMethod === "CARD" && b.paymentStatus === "AUTORISIERT") {
        const v = await voidPayment(b.paymentRef);
        paymentStatus = v.status; // STORNIERT | FEHLGESCHLAGEN
      }
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "STORNIERT",
          trackingStatus: "STORNIERT",
          cancelledAt: new Date(),
          cancelledBy: "DRIVER",
          paymentStatus,
        },
      });
      await prisma.cancellationLog.create({
        data: { bookingId, actorType: "DRIVER", actorId: driverId },
      });
      this.driverActiveBooking.delete(driverId);
      this.driverActiveBookingDest.delete(driverId);
      this.driverNearCompletion.delete(driverId);
      // Falls eine Folgefahrt reserviert war, diese zurueckgeben an die Suche.
      const reservedId = this.driverReservedBooking.get(driverId);
      if (reservedId) {
        this.driverReservedBooking.delete(driverId);
        await prisma.booking.update({
          where: { id: reservedId },
          data: { trackingStatus: "SUCHE", driverId: null, status: "OFFEN", isReserved: false },
        });
        await this.startOrContinueDispatch(reservedId, 0);
      }
      await this.setStatus(driverId, "FREI");
    }
    await this.emitBooking(bookingId);
    return { ok: true };
  }

  // -- Vorbestellungen reservieren ----------------------------------------
  async reserveScheduled(driverId: string, bookingId: string): Promise<{ ok: boolean; reason?: string }> {
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b || !b.isScheduled) return { ok: false, reason: "Keine Vorbestellung." };
    if (b.driverId) return { ok: false, reason: "Bereits reserviert." };
    const live = this.live.get(driverId);
    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        driverId,
        companyId: live?.companyId ?? undefined,
        status: "ZUGEWIESEN",
      },
      include: { driver: true },
    });
    await this.emitBooking(bookingId);
    this.io.to("drivers").emit("driver:scheduledTaken", { bookingId });
    return { ok: true };
  }

  // -- Stornierung ---------------------------------------------------------
  async cancelBooking(bookingId: string, opts: { actorType?: "CUSTOMER" | "ADMIN" | "SYSTEM"; reason?: string } = {}): Promise<void> {
    const actorType = opts.actorType ?? "ADMIN";
    const disp = this.dispatches.get(bookingId);
    if (disp) {
      clearTimeout(disp.timer);
      for (const did of disp.pendingDriverIds) {
        this.io.to(`driver:${did}`).emit("driver:offerCancel", { bookingId });
      }
      this.dispatches.delete(bookingId);
    }
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b) return;
    // Karten-Autorisierung wieder freigeben (Phase 2g).
    let paymentStatus = b.paymentStatus;
    if (b.paymentMethod === "CARD" && b.paymentStatus === "AUTORISIERT") {
      const v = await voidPayment(b.paymentRef);
      paymentStatus = v.status; // STORNIERT | FEHLGESCHLAGEN
    }
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: "STORNIERT",
        trackingStatus: "STORNIERT",
        cancelledAt: new Date(),
        cancelledBy: actorType,
        cancelReason: opts.reason ?? null,
        paymentStatus,
      },
    });
    await prisma.cancellationLog.create({
      data: { bookingId, actorType, reason: opts.reason ?? null },
    });
    if (b.driverId) {
      // War es eine reservierte Folgefahrt? Dann nicht den aktiven Status veraendern.
      if (this.driverReservedBooking.get(b.driverId) === bookingId) {
        this.driverReservedBooking.delete(b.driverId);
        // Fahrer ist weiterhin BESETZT mit seiner aktuellen Fahrt.
        if (this.driverActiveBooking.has(b.driverId)) {
          await this.setStatusInternal(b.driverId, "BESETZT");
        }
      } else {
        this.driverActiveBooking.delete(b.driverId);
        this.driverActiveBookingDest.delete(b.driverId);
        this.driverNearCompletion.delete(b.driverId);
        // Falls dieser Fahrer noch eine reservierte Folgefahrt hat, jene zurueck in die Suche geben.
        const reservedId = this.driverReservedBooking.get(b.driverId);
        if (reservedId) {
          this.driverReservedBooking.delete(b.driverId);
          await prisma.booking.update({
            where: { id: reservedId },
            data: { trackingStatus: "SUCHE", driverId: null, status: "OFFEN", isReserved: false },
          });
          await this.startOrContinueDispatch(reservedId, 0);
        }
        await this.setStatus(b.driverId, "FREI");
      }
    }
    await this.emitBooking(bookingId);
  }

  // -- Zieländerung während der Fahrt (Phase 2f) ---------------------------
  // Neues Endziel und/oder zusaetzlicher Zwischenstopp; Strecke, Dauer und
  // Preis werden ueber die komplette Route (Abholung -> Stopps -> Ziel) neu
  // berechnet. Erlaubt bis zum Fahrtende.
  async changeDestination(
    bookingId: string,
    opts: { dest?: Stop; addStop?: Stop },
  ): Promise<{ ok: boolean; error?: string; booking?: any }> {
    if (!opts.dest && !opts.addStop) {
      return { ok: false, error: "Kein neues Ziel und kein Zwischenstopp angegeben." };
    }
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b) return { ok: false, error: "Auftrag nicht gefunden." };
    if (b.status === "ABGESCHLOSSEN" || b.status === "STORNIERT") {
      return { ok: false, error: "Diese Fahrt kann nicht mehr geändert werden." };
    }

    // Neuen Stopp-/Ziel-Zustand aufbauen.
    const stops: Stop[] = parseStops(b.stops);
    if (opts.addStop) stops.push(opts.addStop);
    const destAddress = opts.dest?.address ?? b.destAddress;
    const destLat = opts.dest?.lat ?? b.destLat;
    const destLng = opts.dest?.lng ?? b.destLng;

    // Gesamtpreis neu berechnen (Firmen-Tarif, falls zugeordnet).
    const company = b.companyId
      ? await prisma.company.findUnique({ where: { id: b.companyId }, select: { slug: true } })
      : null;
    const pricing = await pricingForSlug(company?.slug);
    const points: GeoPoint[] = [
      { lat: b.pickupLat, lng: b.pickupLng },
      ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
      { lat: destLat, lng: destLng },
    ];
    const est = await estimatePriceViaWith(points, pricing);
    const factor = await classFactorForCompanyId(b.companyId, normalizeClass(b.vehicleClass));
    const newMid = applyClassFactor((est.priceMin + est.priceMax) / 2, factor);

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        stops: serializeStops(stops),
        destAddress,
        destLat,
        destLng,
        distanceMeters: est.distanceMeters,
        durationSeconds: est.durationSeconds,
        priceMin: est.priceMin,
        priceMax: est.priceMax,
        tariff: est.tariff,
        // Festpreis nur fortschreiben, wenn er bereits feststand (nach Annahme).
        priceExact: b.priceExact != null ? newMid : null,
        destChangedAt: new Date(),
        destChangeCount: { increment: 1 },
      },
      include: { driver: true },
    });

    // Near-Completion-Logik nutzt das aktuelle Ziel -> mitziehen.
    if (b.driverId && this.driverActiveBooking.get(b.driverId) === bookingId) {
      this.driverActiveBookingDest.set(b.driverId, { lat: destLat, lng: destLng });
      this.driverNearCompletion.delete(b.driverId);
    }

    const dto = await this.emitBooking(bookingId);
    return { ok: true, booking: dto ?? bookingDTO(updated) };
  }

  // -- Hintergrund-Sweep ---------------------------------------------------
  private async tryAssignPending(): Promise<void> {
    // Nur kürzlich erstellte Buchungen erneut versuchen – alles über dem
    // 180-s-Suchfenster wird endgültig nicht mehr disponiert.
    const cutoff = new Date(Date.now() - SEARCH_MAX_MS - 60_000);
    const pending = await prisma.booking.findMany({
      where: {
        status: "OFFEN",
        isScheduled: false,
        trackingStatus: { in: ["SUCHE", "KEIN_FAHRER"] },
        createdAt: { gte: cutoff },
      },
      orderBy: { createdAt: "asc" },
    });
    for (const b of pending) {
      if (!this.dispatches.has(b.id)) {
        // Neuer Versuch ab Phase 0 (startOrContinueDispatch erzwingt die 180-s-Grenze).
        await this.startOrContinueDispatch(b.id, 0);
      }
    }
  }

  private async sweep(): Promise<void> {
    await this.tryAssignPending();
    const dueAt = new Date(Date.now() + SCHEDULED_LEAD_MS);

    // 1) Unzugewiesene, faellige Vorbestellungen -> Fahrersuche starten.
    const due = await prisma.booking.findMany({
      where: { isScheduled: true, status: "OFFEN", scheduledAt: { lte: dueAt } },
    });
    for (const b of due) {
      await prisma.booking.update({ where: { id: b.id }, data: { trackingStatus: "SUCHE" } });
      await this.startOrContinueDispatch(b.id, 0);
    }

    // 2) Vom Fahrer RESERVIERTE Vorbestellungen, die jetzt faellig werden:
    //    live schalten (FAHRER_UNTERWEGS) -> erscheint erst jetzt als aktueller
    //    Auftrag, nicht schon bei der Reservierung Monate vorher.
    const dueReserved = await prisma.booking.findMany({
      where: {
        isScheduled: true,
        driverId: { not: null },
        status: "ZUGEWIESEN",
        trackingStatus: "GEPLANT",
        scheduledAt: { lte: dueAt },
      },
    });
    // 3) Watchdog: hängende ZUGEWIESEN-Buchungen, die seit > 5 Min nicht
    //    weiterprogressed sind (z. B. nach Server-Neustart), auf OFFEN
    //    zurücksetzen und den Fahrer freigeben. Greift NICHT auf Reservierungen
    //    (trackingStatus GEPLANT/RESERVIERT_FAHRER), die kommen weiter regulär.
    const stuckCutoff = new Date(Date.now() - 5 * 60_000);
    const stuck = await prisma.booking.findMany({
      where: {
        status: "ZUGEWIESEN",
        trackingStatus: "FAHRER_UNTERWEGS",
        assignedAt: { lt: stuckCutoff },
      },
    });
    for (const b of stuck) {
      const oldDriverId = b.driverId;
      await prisma.booking.update({
        where: { id: b.id },
        data: {
          status: b.isScheduled ? "OFFEN" : "OFFEN",
          trackingStatus: "SUCHE",
          driverId: null,
          assignedAt: null,
          isReserved: false,
        },
      });
      if (oldDriverId) {
        this.driverActiveBooking.delete(oldDriverId);
        this.driverActiveBookingDest.delete(oldDriverId);
        await this.setStatusInternal(oldDriverId, "FREI");
        await this.refreshDriver?.(oldDriverId);
      }
      await this.emitBooking(b.id);
    }

    // 4) Watchdog: Fahrer mit Status RESERVIERT/BESETZT, die keine aktive
    //    Buchung mehr in der DB haben (Geist-Status durch Crash). Auf FREI zurück.
    const busyDrivers = await prisma.driver.findMany({
      where: { status: { in: ["RESERVIERT", "BESETZT"] }, active: true },
      select: { id: true },
    });
    for (const d of busyDrivers) {
      const hasActive = await prisma.booking.count({
        where: {
          driverId: d.id,
          status: { in: ["ZUGEWIESEN", "AKTIV"] },
        },
      });
      if (hasActive === 0) {
        this.driverActiveBooking.delete(d.id);
        this.driverActiveBookingDest.delete(d.id);
        await this.setStatusInternal(d.id, "FREI");
        await this.refreshDriver?.(d.id);
      }
    }
  }
}
