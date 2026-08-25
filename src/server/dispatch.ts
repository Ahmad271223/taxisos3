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
import { waitCharge } from "../lib/airportExtras";
import { chargeCancellationFee, prepareRidePayment } from "../lib/settle";
import { settleCorporateComplete, releaseCorporate } from "./corporateSettle";
import { fixedPriceFor } from "../lib/fixedPrice";
import { getPlatformConfig } from "../lib/platformConfig";
import { insuranceFare, riskBufferFare, stopSurcharge, applyFloor } from "../lib/fareAdjust";
import { notifyDriverOffer, notifyDriverConfirm } from "../lib/webpush";
import { sendSms } from "../lib/notify";
import { bookingDTO, driverAdmin } from "./serialize";

import { alarm } from "./alarm";
const PHASE_DURATION_MS = 15_000;
const PHASES_METERS = [500, 1000, 2000, 3000, 5000];
// Maximale Dauer der Fahrersuche je Sofortbuchung (ab Suchbeginn). Danach wird
// die Suche endgültig beendet (trackingStatus KEIN_FAHRER) und nicht erneut versucht.
// Über SEARCH_MAX_MS (env) für Tests verkürzbar; Standard 180 s.
const SEARCH_MAX_MS = Number(process.env.SEARCH_MAX_MS ?? 180_000);
const NEAR_COMPLETION_METERS = 300;
// Ankunftszeit waehrend der Anfahrt hoechstens alle 20 s bzw. alle 200 m neu
// berechnen – sonst wuerde jede GPS-Meldung eine Routenabfrage ausloesen.
const ETA_REFRESH_MS = 20_000;
const ETA_REFRESH_METERS = 200;
const SCHEDULED_LEAD_MS = 5 * 60_000;
// Vorlauf fuer die Fahrer-Rueckfrage ("Fahrt weiterhin durchfuehren?").
const DRIVER_CONFIRM_LEAD_MS = 30 * 60_000;
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
  // Letzte Ankunftszeit-Berechnung je Fahrt (Drosselung, siehe refreshEta).
  private lastEtaCalc = new Map<string, { at: number; lat: number; lng: number }>();
  private driverNearCompletion = new Set<string>();
  // Reservierung der naechsten Fahrt (Bolt-Style near completion)
  private driverReservedBooking = new Map<string, string>();
  private lastPersist = new Map<string, number>();

  // Hook fuer den GPS-Simulator (virtuelle Fahrer): wird je Empfaenger gerufen.
  public onOffer?: (bookingId: string, driverId: string) => void;
  // Hook (von realtime gesetzt): pusht den Fahrer-State neu, z. B. wenn eine
  // reservierte Vorbestellung faellig wird.
  public refreshDriver?: (driverId: string) => void | Promise<void>;
  // Allen verbundenen Fahrern einen frischen driver:state schicken (z. B. wenn
  // eine Vorbestellung wieder in den Pool zurueckgeht).
  public refreshAllDrivers?: () => void | Promise<void>;

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
    // Nur WIRKLICH laufende Fahrten als aktuellen Auftrag wiederherstellen.
    // Reservierte Vorbestellungen (GEPLANT) duerfen hier NICHT landen: sonst
    // gilt der Fahrer nach einem Neustart als "in Fahrt" und die naechste
    // angenommene Fahrt wird faelschlich RESERVIERT_FAHRER + Fahrer RESERVIERT
    // – in dem Zustand sind im Fahrer-Dashboard alle Trip-Buttons gesperrt.
    const active = await prisma.booking.findMany({
      where: {
        status: { in: ["ZUGEWIESEN", "AKTIV"] },
        driverId: { not: null },
        trackingStatus: { in: ["FAHRER_GEFUNDEN", "FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT"] },
      },
    });
    for (const b of active) {
      if (b.driverId) {
        this.driverActiveBooking.set(b.driverId, b.id);
        this.driverActiveBookingDest.set(b.driverId, { lat: b.destLat, lng: b.destLng });
      }
    }
    // Vorgemerkte Folgefahrten (angenommen, waehrend eine andere lief) in die
    // richtige Map zurueckholen, damit sie nach Fahrtende live geschaltet werden.
    const reserved = await prisma.booking.findMany({
      where: { status: "ZUGEWIESEN", driverId: { not: null }, trackingStatus: "RESERVIERT_FAHRER" },
    });
    for (const b of reserved) {
      if (b.driverId) this.driverReservedBooking.set(b.driverId, b.id);
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
      include: { driver: true, card: true },
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

  /**
   * Ankunftszeit waehrend der Anfahrt fortschreiben.
   *
   * Die Route wird bei einem echten Kartendienst abgefragt – das darf nicht bei
   * JEDER GPS-Meldung passieren (ein Fahrer sendet im Sekundentakt). Deshalb nur
   * neu rechnen, wenn seit der letzten Berechnung genug Zeit vergangen ist ODER
   * der Wagen ein Stueck gefahren ist. Nach dem Einsteigen ist die Zeit bis zum
   * Abholpunkt gegenstandslos, dann wird nichts mehr gesendet.
   */
  private async refreshEta(bookingId: string, driverId: string, lat: number, lng: number): Promise<void> {
    const letzte = this.lastEtaCalc.get(bookingId);
    const alt = !letzte || Date.now() - letzte.at > ETA_REFRESH_MS;
    const bewegt = letzte ? haversineMeters({ lat, lng }, { lat: letzte.lat, lng: letzte.lng }) > ETA_REFRESH_METERS : true;
    if (!alt && !bewegt) return;
    this.lastEtaCalc.set(bookingId, { at: Date.now(), lat, lng });

    try {
      const b = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { trackingStatus: true, pickupLat: true, pickupLng: true, driverId: true },
      });
      // Nur auf der Anfahrt, und nur fuer den Fahrer, der die Fahrt hat.
      if (!b || b.driverId !== driverId) return;
      if (!["FAHRER_GEFUNDEN", "FAHRER_UNTERWEGS"].includes(b.trackingStatus)) return;

      const r = await routeBetween({ lat, lng }, { lat: b.pickupLat, lng: b.pickupLng });
      const eta = r?.durationSeconds ?? null;
      if (eta == null) return;
      this.io.to(`booking:${bookingId}`).emit("booking:eta", { bookingId, etaSeconds: eta });
      this.io.to(`driver:${driverId}`).emit("driver:eta", { bookingId, etaSeconds: eta });
    } catch {
      /* Routendienst nicht erreichbar: alte Anzeige stehen lassen */
    }
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

      // Ankunftszeit mitlaufen lassen. Ohne das blieb im Kundenfenster die bei
      // der Annahme berechnete Zeit stehen, waehrend sich der Wagen sichtbar
      // naeherte ("Ankunft in ca. 6 Min", auch wenn er schon vor der Tuer war).
      void this.refreshEta(activeBooking, driverId, lat, lng);

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

  /**
   * Deckungspruefung, sobald die Fahrt live geht (Fahrer unterwegs).
   *
   * Erst hier – nicht beim Buchen – wird der geschaetzte Fahrpreis bei der Bank
   * reserviert. Damit steht fest, dass die Karte gedeckt ist, BEVOR der Gast
   * einsteigt. Klappt es nicht, erfahren es Kunde und Zentrale sofort.
   *
   * Laeuft bewusst im Hintergrund: die Fahrerzuweisung darf nicht auf Stripe warten.
   */
  private async checkFunds(bookingId: string): Promise<void> {
    const res = await prepareRidePayment(bookingId).catch((e) => ({
      ok: false,
      error: e?.message ?? "Zahlung konnte nicht geprüft werden.",
      skipped: false,
    }));
    if (res.ok || (res as any).skipped) return;

    const b = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { customerPhone: true, companyId: true },
    });
    if (!b) return;

    await sendSms(
      b.customerPhone,
      `Ihre hinterlegte Karte konnte nicht bestätigt werden (${res.error}). Bitte hinterlegen Sie in Ihrem Konto eine andere Karte oder zahlen Sie bar beim Fahrer.`,
      { dedupeKey: `card-check-failed:${bookingId}`, kind: "PAYMENT_FAILED", bookingId },
    ).catch(() => {});

    // Zentrale/Unternehmen sehen es live im Dashboard.
    if (b.companyId) {
      this.io.to(`admins:${b.companyId}`).emit("booking:paymentIssue", { bookingId, error: res.error });
    }
    await this.emitBooking(bookingId);
  }

  // Suche erfolglos beendet: der Kunde sitzt selten vor der Tracking-Seite, also
  // per SMS informieren und die Nummer der Zentrale mitschicken – dort kann ein
  // Disponent einen Fahrer direkt beauftragen. Genau EINE SMS je Buchung.
  private async notifyNoDriver(b: any): Promise<void> {
    // Ein verlorener Auftrag ist ein verlorener Kunde. Einzelfaelle sind
    // normal (nachts, Randlage); haeufen sie sich, stimmt etwas nicht –
    // deshalb faesst die Alarmierung sie zusammen und nennt die Anzahl.
    alarm("warnung", "kein-fahrer-gefunden", "Kein Fahrer gefunden – Auftrag verfaellt", {
      auftrag: b.id,
      firma: b.companyId ?? "plattformweit",
      abholung: b.pickupAddress,
    });

    const hotline = (process.env.NEXT_PUBLIC_PLATFORM_PHONE ?? "").trim();
    const text = hotline
      ? `Leider ist gerade kein Taxi frei. Bitte stellen Sie eine neue Anfrage oder rufen Sie unsere Zentrale an: ${hotline} – wir beauftragen dann direkt einen Fahrer für Sie.`
      : `Leider ist gerade kein Taxi frei. Bitte stellen Sie in Kürze eine neue Anfrage.`;
    await sendSms(b.customerPhone, text, {
      dedupeKey: `no-driver:${b.id}:${b.reassignCount ?? 0}`,
      kind: "NO_DRIVER",
      bookingId: b.id,
    }).catch(() => {});
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
        await this.notifyNoDriver(b);
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
        await this.notifyNoDriver(b);
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

    // Hotel Smart Fleet Routing: in den ersten Phasen bevorzugt die Whitelist-
    // Flotte anfragen. Gibt es dort Fahrer im Radius -> nur diese; sonst normaler
    // Open-Marketplace-Fallback (keine Einschränkung -> Fahrt stockt nie).
    const preferredCompanies = csvToSet(b.preferredCompanyIds);
    if (preferredCompanies.size > 0 && phaseIndex <= 1 && !b.requestedDriverId) {
      const pref = candidates.filter((c) => preferredCompanies.has(c.d.companyId));
      if (pref.length > 0) candidates = pref;
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
      // Eine bereits endgueltig beendete Suche NICHT wiederbeleben: sonst
      // springt der Auftrag von KEIN_FAHRER zurueck auf SUCHE und haengt dort
      // dauerhaft, obwohl das Suchfenster abgelaufen ist.
      if (b.trackingStatus !== "SUCHE" && b.trackingStatus !== "KEIN_FAHRER") {
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
      include: { driver: true, card: true },
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
      // Web-Push: benachrichtigt das Fahrer-Gerät auch, wenn die App im
      // Hintergrund/Tab inaktiv ist (No-Op ohne VAPID-Keys).
      notifyDriverOffer(c.d.id, dto).catch(() => {});
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
    let priceIsFixed = false;
    try {
      if (b0) {
        const numStops = parseStops(b0.stops).length;
        // Meter-Schätzpreis (Klassenfaktor) + Strecke für alle Modi berechnen.
        const company = live?.companyId
          ? await prisma.company.findUnique({ where: { id: live.companyId }, select: { slug: true } })
          : null;
        const pricing = await pricingForSlug(company?.slug);
        const est = await estimatePriceViaWith(bookingRoutePoints(b0), pricing);
        const factor = await classFactorForCompanyId(live?.companyId, normalizeClass(b0.vehicleClass));
        const metered = applyClassFactor((est.priceMin + est.priceMax) / 2, factor);
        const km = (est.distanceMeters ?? 0) / 1000;

        // Plattform-Leitplanken + Firmen-Pricing (Buffer/Pro-Stopp) laden.
        const cfg = await getPlatformConfig();
        const pr = live?.companyId ? await prisma.pricing.findUnique({ where: { companyId: live.companyId } }) : null;

        // 1) Krankenkassen-/DTA-Tarif hat Vorrang (fester Satz, ohne Markt-Logik).
        const insFare = b0.payerType === "INSURANCE" ? insuranceFare(km, cfg) : null;
        if (insFare != null) {
          priceExact = insFare;
          priceIsFixed = true;
        } else {
          // 2) Manuelle Festpreis-Regel (nur Direktfahrt) -> 3) dynamischer Buffer -> 4) Meter.
          let base = metered;
          if (live?.companyId && numStops === 0) {
            const rules = await prisma.fixedPriceRule.findMany({ where: { companyId: live.companyId, active: true } });
            const fixed = fixedPriceFor(rules, { lat: b0.pickupLat, lng: b0.pickupLng }, { lat: b0.destLat, lng: b0.destLng }, normalizeClass(b0.vehicleClass));
            if (fixed != null) { base = fixed; priceIsFixed = true; }
          }
          if (!priceIsFixed) {
            const buf = riskBufferFare(metered, pr?.fixedBufferPct ?? 0);
            if (buf != null) { base = buf; priceIsFixed = true; }
          }
          // Pro-Stopp-Gebühr + globale Preisuntergrenze.
          base += stopSurcharge(numStops, pr?.perStopFee ?? 0);
          base = applyFloor(base, km, cfg);
          priceExact = base;
        }
      }
    } catch {
      /* fallback: priceExact bleibt null, wird bei complete neu berechnet */
    }

    const trackingStatus = isReservation ? "RESERVIERT_FAHRER" : "FAHRER_UNTERWEGS";

    // Kennzeichen fuer den Schnappschuss: der Live-Zustand im Speicher fuehrt
    // es nicht mit, deshalb einmal aus der Datenbank holen.
    const kennzeichenSnap = (await prisma.driver.findUnique({
      where: { id: driverId },
      select: { vehiclePlate: true },
    }))?.vehiclePlate ?? undefined;

    const updated = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: "ZUGEWIESEN",
        trackingStatus,
        driverId,
        companyId: live?.companyId ?? undefined,
        acceptedAt: now,
        priceExact,
        priceIsFixed,
        isReserved: isReservation,
        // Schnappschuss fuer den spaeteren Beleg: wird der Fahrer geloescht
        // (Company->Driver ist Cascade), muss trotzdem nachvollziehbar
        // bleiben, wer gefahren ist.
        driverNameSnap: live?.name ?? undefined,
        driverPlateSnap: kennzeichenSnap,
      },
      include: { driver: true, card: true },
    });

    if (isReservation) {
      // Reservierte Folgefahrt: aktuelle Fahrt laeuft weiter,
      // Fahrer wird auf RESERVIERT gesetzt, neuer Auftrag wartet.
      // Geld wird hier NICHT reserviert – erst wenn die Fahrt wirklich losgeht.
      this.driverReservedBooking.set(driverId, bookingId);
      await this.setStatusInternal(driverId, "RESERVIERT");
    } else {
      // Fahrt geht jetzt live -> Deckung der Karte pruefen.
      void this.checkFunds(bookingId);
      this.driverActiveBooking.set(driverId, bookingId);
      this.driverActiveBookingDest.set(driverId, { lat: updated.destLat, lng: updated.destLng });
      this.driverNearCompletion.delete(driverId);
      await this.setStatusInternal(driverId, "BESETZT");
    }

    // Kunde per SMS informieren, dass ein Fahrer unterwegs ist. Nach einer
    // Fahrer-Absage ist das ausdruecklich die "neuer Fahrer gefunden"-Meldung.
    const dv: any = (updated as any).driver;
    const wasReassigned = (updated.reassignCount ?? 0) > 0;
    const veh = [dv?.vehicleColor, dv?.vehicleModel].filter(Boolean).join(" ");
    const fahrzeug = `${veh}${dv?.vehiclePlate ? ` (${dv.vehiclePlate})` : ""}`.trim();
    sendSms(
      updated.customerPhone,
      wasReassigned
        ? `Gute Nachricht: Wir haben einen neuen Fahrer für Sie gefunden. ${dv?.name ?? "Ihr Fahrer"}${fahrzeug ? `, ${fahrzeug}` : ""} übernimmt Ihre Fahrt.`
        : `Ihr Taxi ist unterwegs. Fahrer: ${dv?.name ?? ""}${fahrzeug ? `, ${fahrzeug}` : ""}.`,
      {
        // Je Zuweisungsrunde genau eine SMS – auch bei Reconnects/Retries.
        dedupeKey: `driver-assigned:${bookingId}:${updated.reassignCount ?? 0}`,
        kind: wasReassigned ? "NEW_DRIVER" : "DRIVER_ASSIGNED",
        bookingId,
      },
    ).catch(() => {});

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
      include: { driver: true, card: true },
    });

    void this.checkFunds(bookingId); // Fahrt geht live -> Karte auf Deckung pruefen
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
  async tripAction(driverId: string, bookingId: string, action: "arrived" | "start" | "complete" | "cancel" | "noshow"): Promise<{ ok: boolean }> {
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b || b.driverId !== driverId) return { ok: false };
    // Abgeschlossene/stornierte Fahrten sind endgueltig: doppelte Klicks oder
    // ein spaeter eintreffendes Event duerfen den Zustand nicht zurueckdrehen.
    if (b.status === "ABGESCHLOSSEN" || b.status === "STORNIERT") return { ok: false };

    if (action === "arrived") {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { trackingStatus: "FAHRER_ANGEKOMMEN", arrivedAt: new Date() },
      });
      // Der Gast wartet nicht zwingend auf der Tracking-Seite -> eine SMS.
      sendSms(
        b.customerPhone,
        `Ihr Taxi ist da und wartet an der Abholadresse: ${String(b.pickupAddress).split(",")[0]}.`,
        { dedupeKey: `arrived:${bookingId}:${b.reassignCount ?? 0}`, kind: "DRIVER_ARRIVED", bookingId },
      ).catch(() => {});
    } else if (action === "start") {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: "AKTIV", trackingStatus: "FAHRT_LAEUFT", startedAt: new Date() },
      });
    } else if (action === "complete") {
      // Endpreis: Basisfahrpreis + Meet&Greet-Aufschlag + Wartezeit (Fairpreis).
      // priceMax/priceMin enthalten den Meet&Greet-Aufschlag bereits, priceExact
      // nicht -> Basis konsistent normalisieren, Aufschlag genau einmal addieren.
      const wait = waitCharge(b.arrivedAt, b.startedAt);
      const mgFee = b.meetGreetFee ?? 0;
      const baseFare = b.priceExact != null ? b.priceExact : Math.max(0, (b.priceMax ?? b.priceMin ?? 0) - mgFee);
      // Event-Promo-Rabatt mindert den Endpreis (nie unter 0).
      const fare = Math.max(0, Math.round((baseFare + mgFee + wait.fee - (b.promoDiscount ?? 0)) * 100) / 100);
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

      // Karte belasten (Phase 2g): Fahrpreis + Trinkgeld vom Hold abbuchen.
      // Capture darf den autorisierten Betrag nicht uebersteigen -> Trinkgeld
      // auf den freien Rest des Holds deckeln (kein neuer Hold moeglich).
      // WICHTIG: Bei Kartenzahlung wird hier NICHT abgebucht. Der Kunde bekommt
      // zuerst die Trinkgeld-Auswahl (Punkt 9/10). Abgebucht wird danach – oder
      // automatisch ohne Trinkgeld, wenn er nicht reagiert (Punkt 13).
      // Barzahlung: gar keine Trinkgeld-Abfrage, Fahrt ist einfach beendet.
      const isCardRide = b.paymentMethod === "CARD" && b.paymentStatus === "KARTE_HINTERLEGT";

      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "ABGESCHLOSSEN",
          trackingStatus: "BEENDET",
          completedAt: new Date(),
          fare,
          // Trinkgeld wird erst NACH Fahrtende gewaehlt -> hier immer 0.
          tip: 0,
          waitMinutes: wait.minutes || null,
          waitFee: wait.fee || null,
          platformFeeRate,
          platformFee,
          companyNet,
          // Startet das Trinkgeld-Zeitfenster nur bei Kartenzahlung.
          ...(isCardRide ? { tipPromptedAt: new Date() } : {}),
        },
      });
      this.driverActiveBooking.delete(driverId);
      this.driverActiveBookingDest.delete(driverId);
      this.driverNearCompletion.delete(driverId);

      // QR-Firmenmobilität: Hold auf den tatsächlichen Endpreis abrechnen.
      await settleCorporateComplete(b, fare);

      // Bonus-/Punktesystem (Phase 18): 1 Punkt je vollem Euro Fahrpreis.
      if (b.customerId && fare > 0) {
        await prisma.customer
          .update({ where: { id: b.customerId }, data: { points: { increment: Math.max(1, Math.round(fare)) } } })
          .catch(() => {});
      }

      // Reservierte Folgefahrt automatisch starten?
      const reservedId = this.driverReservedBooking.get(driverId);
      let promoted = false;
      if (reservedId) {
        this.driverReservedBooking.delete(driverId);
        // WICHTIG: nur eine noch offene Vormerkung live schalten. Ohne diese
        // Bedingung wuerde eine bereits beendete/stornierte Fahrt wieder auf
        // FAHRER_UNTERWEGS gesetzt ("wiederbelebt") – sie stand dann auf
        // ABGESCHLOSSEN + FAHRER_UNTERWEGS zugleich.
        const claim = await prisma.booking.updateMany({
          where: { id: reservedId, driverId, status: "ZUGEWIESEN", trackingStatus: "RESERVIERT_FAHRER" },
          data: { trackingStatus: "FAHRER_UNTERWEGS", isReserved: false },
        });
        if (claim.count > 0) {
          const reserved = await prisma.booking.findUnique({ where: { id: reservedId } });
          if (reserved) {
            void this.checkFunds(reservedId); // Folgefahrt geht jetzt live
            this.driverActiveBooking.set(driverId, reservedId);
            this.driverActiveBookingDest.set(driverId, { lat: reserved.destLat, lng: reserved.destLng });
            await this.setStatusInternal(driverId, "BESETZT");
            await this.emitBooking(reservedId);
            promoted = true;
          }
        }
      }
      if (!promoted) {
        await this.setStatus(driverId, "FREI");
      }
    } else if (action === "noshow") {
      // Gast nicht erschienen: nur nach Ankunft des Fahrers (Wartepflicht erfüllt).
      if (b.trackingStatus !== "FAHRER_ANGEKOMMEN") return { ok: false };
      // No-Show-Gebühr aus dem Firmen-Tarif (0 = keine).
      const pr = b.companyId ? await prisma.pricing.findUnique({ where: { companyId: b.companyId } }) : null;
      const fee = Math.max(0, pr?.noShowFee ?? 0);
      // Provision auf die Gebühr.
      let platformFeeRate: number | null = null;
      let platformFee: number | null = null;
      let companyNet: number | null = null;
      if (fee > 0) {
        const company = b.companyId ? await prisma.company.findUnique({ where: { id: b.companyId }, select: { cityTier: true } }) : null;
        const c = computeCommission(fee, company?.cityTier);
        platformFeeRate = c.rate;
        platformFee = c.platformFee;
        companyNet = c.companyNet;
      }
      // Karte: Gebuehr direkt von der hinterlegten Karte abbuchen. Es gibt
      // keinen Hold mehr, der freigegeben werden muesste. Bar: Gebuehr bleibt offen.
      let paymentStatus = b.paymentStatus;
      if (b.paymentMethod === "CARD") {
        paymentStatus = await chargeCancellationFee(bookingId, fee);
      }
      await prisma.booking.update({
        where: { id: bookingId },
        data: {
          status: "STORNIERT",
          trackingStatus: "STORNIERT",
          cancelledAt: new Date(),
          cancelledBy: "DRIVER",
          cancelReason: "NO_SHOW",
          noShowFee: fee || null,
          fare: fee || null,
          platformFeeRate,
          platformFee,
          companyNet,
          paymentStatus,
        },
      });
      await prisma.cancellationLog.create({ data: { bookingId, actorType: "DRIVER", actorId: driverId, reason: "NO_SHOW" } });
      await releaseCorporate(b);
      this.driverActiveBooking.delete(driverId);
      this.driverActiveBookingDest.delete(driverId);
      this.driverNearCompletion.delete(driverId);
      const reservedNoShow = this.driverReservedBooking.get(driverId);
      if (reservedNoShow) {
        this.driverReservedBooking.delete(driverId);
        await prisma.booking.update({ where: { id: reservedNoShow }, data: { trackingStatus: "SUCHE", driverId: null, status: "OFFEN", isReserved: false } });
        await this.startOrContinueDispatch(reservedNoShow, 0);
      }
      await this.setStatus(driverId, "FREI");
    } else if (action === "cancel") {
      // Fahrer storniert vor Fahrtbeginn: keine Zahlung, keine Gebuehr.
      // Die vorgemerkte Karte wird nur freigegeben (es gab nie einen Hold).
      let paymentStatus = b.paymentStatus;
      if (b.paymentMethod === "CARD") {
        paymentStatus = await chargeCancellationFee(bookingId, 0);
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
      // QR-Firmenmobilität: gebuchten Hold + Fahrt wieder freigeben.
      await releaseCorporate(b);
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
    // Wie assignFromPool: der trackingStatus MUSS explizit gesetzt werden.
    // Eine faellige Vorbestellung steht nach dem Sweep auf "SUCHE" – bliebe sie
    // dabei, haelt driverState() sie fuer die laufende Fahrt und das
    // Fahrer-Dashboard blockiert (alle Trip-/Status-Buttons disabled).
    const immediate = !(b.isScheduled && b.scheduledAt && b.scheduledAt.getTime() > Date.now() + SCHEDULED_LEAD_MS);
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        driverId,
        companyId: live?.companyId ?? undefined,
        status: "ZUGEWIESEN",
        ...(immediate
          ? { trackingStatus: "FAHRER_UNTERWEGS", isReserved: false, acceptedAt: new Date() }
          : { trackingStatus: "GEPLANT", isReserved: true }),
      },
    });
    if (immediate) {
      // Faellige Fahrt: wird sofort zum aktuellen Auftrag des Fahrers.
      void this.checkFunds(bookingId);
      const b2 = await prisma.booking.findUnique({ where: { id: bookingId } });
      this.driverActiveBooking.set(driverId, bookingId);
      if (b2) this.driverActiveBookingDest.set(driverId, { lat: b2.destLat, lng: b2.destLng });
      await this.setStatusInternal(driverId, "BESETZT");
    }
    // Wurde die Fahrt zuvor von einem Fahrer abgesagt, ist das die
    // "neuer Fahrer gefunden"-Meldung an den Kunden.
    if ((b.reassignCount ?? 0) > 0) {
      const drv = await prisma.driver.findUnique({ where: { id: driverId } });
      const veh = [drv?.vehicleColor, drv?.vehicleModel].filter(Boolean).join(" ");
      const fahrzeug = `${veh}${drv?.vehiclePlate ? ` (${drv.vehiclePlate})` : ""}`.trim();
      sendSms(
        b.customerPhone,
        `Gute Nachricht: Wir haben einen neuen Fahrer für Sie gefunden. ${drv?.name ?? "Ihr Fahrer"}${fahrzeug ? `, ${fahrzeug}` : ""} übernimmt Ihre Fahrt.`,
        { dedupeKey: `driver-assigned:${bookingId}:${b.reassignCount}`, kind: "NEW_DRIVER", bookingId },
      ).catch(() => {});
    }

    await this.emitBooking(bookingId);
    this.io.to("drivers").emit("driver:scheduledTaken", { bookingId });
    return { ok: true };
  }

  // Eine Zentrale (Admin) weist eine Pool-Krankenfahrt (dispatchMode ADMIN)
  // einem ihrer Fahrer zu. Erster Zugriff gewinnt (atomar). Sofort-Fahrten
  // werden direkt zum aktuellen Auftrag des Fahrers; Vorbestellungen bleiben
  // GEPLANT und werden vom Sweep zur Fahrtzeit live geschaltet.
  async assignFromPool(bookingId: string, driverId: string, companyId: string): Promise<{ ok: boolean; reason?: string }> {
    // Atomarer Claim: nur wenn noch im Pool (ADMIN, offen, ohne Fahrer).
    const claim = await prisma.booking.updateMany({
      where: { id: bookingId, dispatchMode: "ADMIN", status: "OFFEN", driverId: null },
      data: { driverId, companyId, status: "ZUGEWIESEN", assignedAt: new Date() },
    });
    if (claim.count === 0) return { ok: false, reason: "Fahrt ist nicht mehr im Pool (bereits vergeben?)." };

    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b) return { ok: false, reason: "Fahrt nicht gefunden." };

    const immediate = !(b.isScheduled && b.scheduledAt && b.scheduledAt.getTime() > Date.now() + SCHEDULED_LEAD_MS);
    if (immediate) {
      // Direkt der aktuelle Auftrag des Fahrers.
      await prisma.booking.update({ where: { id: bookingId }, data: { trackingStatus: "FAHRER_UNTERWEGS", isReserved: false } });
      void this.checkFunds(bookingId);
      this.driverActiveBooking.set(driverId, bookingId);
      this.driverActiveBookingDest.set(driverId, { lat: b.destLat, lng: b.destLng });
      await this.setStatusInternal(driverId, "BESETZT");
    } else {
      // Reservierte Vorbestellung: erscheint unter „Meine geplanten Fahrten",
      // der Sweep schaltet sie zur Fahrtzeit live.
      await prisma.booking.update({ where: { id: bookingId }, data: { trackingStatus: "GEPLANT", isReserved: true } });
    }
    await this.emitBooking(bookingId);
    await this.refreshDriver?.(driverId);
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

    // Storno-Gebühr (nur bei Kunden-Storno): fällig, wenn bereits ein Fahrer
    // zugewiesen/unterwegs ist ODER bei Vorbestellung zu kurz vor der Abholung.
    let fee = 0;
    let platformFeeRate: number | null = null;
    let platformFee: number | null = null;
    let companyNet: number | null = null;
    if (actorType === "CUSTOMER" && b.companyId) {
      const pr = await prisma.pricing.findUnique({ where: { companyId: b.companyId } });
      const cf = Math.max(0, pr?.cancelFee ?? 0);
      const freeMin = pr?.freeCancelMinutes ?? 0;
      const assigned = ["FAHRER_GEFUNDEN", "FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT", "RESERVIERT_FAHRER"].includes(b.trackingStatus);
      const tooLate = b.isScheduled && b.scheduledAt ? b.scheduledAt.getTime() - Date.now() < freeMin * 60_000 : false;
      if (cf > 0 && (assigned || tooLate)) {
        fee = cf;
        const company = await prisma.company.findUnique({ where: { id: b.companyId }, select: { cityTier: true } });
        const c = computeCommission(fee, company?.cityTier);
        platformFeeRate = c.rate;
        platformFee = c.platformFee;
        companyNet = c.companyNet;
      }
    }

    // Karte: Storno-Gebuehr direkt von der hinterlegten Karte abbuchen;
    // ohne Gebuehr wird die Karte einfach freigegeben (kein Hold vorhanden).
    let paymentStatus = b.paymentStatus;
    if (b.paymentMethod === "CARD") {
      paymentStatus = await chargeCancellationFee(bookingId, fee);
    }
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: "STORNIERT",
        trackingStatus: "STORNIERT",
        cancelledAt: new Date(),
        cancelledBy: actorType,
        cancelReason: fee > 0 ? "LATE_CANCEL" : opts.reason ?? null,
        fare: fee || null,
        platformFeeRate,
        platformFee,
        companyNet,
        paymentStatus,
      },
    });
    await prisma.cancellationLog.create({
      data: { bookingId, actorType, reason: opts.reason ?? null },
    });
    // QR-Firmenmobilität: gebuchten Hold + Fahrt wieder freigeben.
    await releaseCorporate(b);
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
      include: { driver: true, card: true },
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

  // -- Fahrer-Rueckfrage vor einer reservierten Vorbestellung ---------------
  // 30 Min vor der Abholung: "Moechtest du diese Fahrt weiterhin durchfuehren?"
  // Ja  -> Fahrt bleibt beim Fahrer.
  // Nein-> im Fahrer-UI erscheint der Button "Fahrt stornieren"; erst dieser
  //        gibt die Fahrt frei (siehe releaseScheduledByDriver).
  private async askDriverConfirmations(): Promise<void> {
    const askFrom = new Date(Date.now() + DRIVER_CONFIRM_LEAD_MS);
    const due = await prisma.booking.findMany({
      where: {
        isScheduled: true,
        status: "ZUGEWIESEN",
        trackingStatus: "GEPLANT",
        driverId: { not: null },
        scheduledAt: { lte: askFrom, gt: new Date() },
        driverConfirmAskedAt: null,
      },
      include: { driver: true, card: true },
    });
    for (const b of due) {
      if (!b.driverId) continue;
      // Merker ZUERST setzen (atomar): verhindert doppelte Rueckfragen bei
      // ueberlappenden Sweeps oder mehreren Server-Instanzen.
      const claim = await prisma.booking.updateMany({
        where: { id: b.id, driverConfirmAskedAt: null },
        data: { driverConfirmAskedAt: new Date() },
      });
      if (claim.count === 0) continue;

      const dto = bookingDTO(b);
      this.io.to(`driver:${b.driverId}`).emit("driver:confirmScheduled", {
        bookingId: b.id,
        scheduledAt: b.scheduledAt,
        pickupAddress: b.pickupAddress,
        destAddress: b.destAddress,
        booking: dto,
      });
      // Push, falls die App im Hintergrund/das Handy gesperrt ist.
      notifyDriverConfirm(b.driverId, b).catch(() => {});
      await this.refreshDriver?.(b.driverId);
    }
  }

  // Fahrer beantwortet die Rueckfrage.
  async respondScheduledConfirm(driverId: string, bookingId: string, keep: boolean): Promise<{ ok: boolean; reason?: string }> {
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b || b.driverId !== driverId) return { ok: false, reason: "Fahrt nicht gefunden." };
    if (b.status !== "ZUGEWIESEN") return { ok: false, reason: "Fahrt ist nicht mehr aktiv." };
    await prisma.booking.update({
      where: { id: bookingId },
      data: keep
        ? { driverConfirmedAt: new Date(), driverDeclinedAt: null }
        : { driverDeclinedAt: new Date(), driverConfirmedAt: null },
    });
    await this.emitBooking(bookingId);
    await this.refreshDriver?.(driverId);
    return { ok: true };
  }

  // Endgueltige Absage durch den Fahrer ("Fahrt stornieren"-Button).
  // Der Kunde wird per SMS informiert und die Fahrt sofort neu vermittelt.
  async releaseScheduledByDriver(driverId: string, bookingId: string): Promise<{ ok: boolean; reason?: string }> {
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b || b.driverId !== driverId) return { ok: false, reason: "Fahrt nicht gefunden." };
    if (!["ZUGEWIESEN", "OFFEN"].includes(b.status)) return { ok: false, reason: "Fahrt ist nicht mehr stornierbar." };

    // Liegt die Fahrt noch weiter in der Zukunft, darf sie NICHT sofort live
    // disponiert werden (der Ersatzfahrer wuerde sofort losfahren). Sie geht
    // zurueck in den Pool der offenen Vorbestellungen: alle Fahrer sehen sie
    // sofort und koennen sie reservieren; der Sweep schaltet sie zur Fahrtzeit live.
    const stillFuture = !!(b.isScheduled && b.scheduledAt && b.scheduledAt.getTime() > Date.now() + SCHEDULED_LEAD_MS);

    // Atomar freigeben: nur der Fahrer, dem sie aktuell gehoert, darf sie loesen.
    const released = await prisma.booking.updateMany({
      where: { id: bookingId, driverId },
      data: {
        driverId: null,
        status: "OFFEN",
        trackingStatus: stillFuture ? "GEPLANT" : "SUCHE",
        isReserved: false,
        acceptedAt: null,
        driverConfirmAskedAt: null,
        driverConfirmedAt: null,
        driverDeclinedAt: null,
        reassignCount: { increment: 1 },
        // Der absagende Fahrer bekommt die Fahrt nicht erneut angeboten.
        declinedDriverIds: b.declinedDriverIds
          ? Array.from(new Set([...b.declinedDriverIds.split(",").filter(Boolean), driverId])).join(",")
          : driverId,
      },
    });
    if (released.count === 0) return { ok: false, reason: "Fahrt wurde bereits neu vergeben." };

    this.driverActiveBooking.delete(driverId);
    this.driverActiveBookingDest.delete(driverId);
    this.driverReservedBooking.delete(driverId);

    // Kunde informieren – genau EINMAL je Absage (dedupeKey mit Zaehler).
    const when = b.scheduledAt
      ? new Date(b.scheduledAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
      : "";
    sendSms(
      b.customerPhone,
      `Ihre Fahrt${when ? ` für ${when} Uhr` : ""} wurde vom Fahrer storniert. Wir suchen bereits einen neuen Fahrer für Sie.`,
      { dedupeKey: `driver-cancel:${bookingId}:${(b.reassignCount ?? 0) + 1}`, kind: "DRIVER_CANCELLED", bookingId },
    ).catch(() => {});

    await this.emitBooking(bookingId);
    await this.refreshDriver?.(driverId);

    if (stillFuture) {
      // Alle Fahrer sofort ueber die wieder freie Vorbestellung informieren.
      this.io.to("drivers").emit("driver:scheduledReleased", { bookingId });
      await this.refreshAllDrivers?.();
    } else {
      // Faellige Fahrt: sofort neuen Fahrer suchen.
      await this.startOrContinueDispatch(bookingId, 0);
    }
    return { ok: true };
  }

  private async sweep(): Promise<void> {
    await this.tryAssignPending();
    await this.askDriverConfirmations().catch(() => {});
    const dueAt = new Date(Date.now() + SCHEDULED_LEAD_MS);

    // 1) Unzugewiesene, faellige Vorbestellungen -> Fahrersuche starten.
    //    NUR AUTO-Fahrten: ADMIN-Pool-Fahrten (Krankenfahrten) werden von einer
    //    Zentrale zugewiesen und niemals automatisch an Fahrer ausgespielt.
    const due = await prisma.booking.findMany({
      where: { isScheduled: true, status: "OFFEN", scheduledAt: { lte: dueAt }, dispatchMode: "AUTO" },
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
    for (const b of dueReserved) {
      if (!b.driverId) continue;
      // Fährt der Fahrer gerade eine andere Fahrt? Dann geht diese Vorbestellung
      // erst nach deren Abschluss live (über die reservedBooking-Logik im complete).
      const current = this.driverActiveBooking.get(b.driverId);
      if (current && current !== b.id) continue;
      await prisma.booking.update({
        where: { id: b.id },
        data: { trackingStatus: "FAHRER_UNTERWEGS", isReserved: false },
      });
      // Vorbestellung geht jetzt live -> jetzt (und nicht Tage vorher) pruefen,
      // ob die hinterlegte Karte gedeckt ist.
      void this.checkFunds(b.id);
      this.driverActiveBooking.set(b.driverId, b.id);
      this.driverActiveBookingDest.set(b.driverId, { lat: b.destLat, lng: b.destLng });
      await this.setStatusInternal(b.driverId, "BESETZT");
      await this.emitBooking(b.id);
      await this.refreshDriver?.(b.driverId);
    }

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
