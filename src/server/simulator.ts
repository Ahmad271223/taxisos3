// GPS-Simulator: bewegt die Fahrer ohne echte Smartphones, damit die
// Live-Karte und der komplette Dispatch-Ablauf demonstrierbar sind.
//
// Ein Fahrer wird NUR simuliert, solange er nicht echt per Browser
// eingeloggt ist (realDrivers). Loggt sich jemand als fahrer1 ein,
// uebernimmt die echte Person die Kontrolle ueber diesen Fahrer.

import { prisma } from "../lib/prisma";
import { haversineMeters } from "../lib/geo";
import type { Dispatcher } from "./dispatch";

type Phase = "idle" | "offered" | "toPickup" | "atPickup" | "toDest";

interface SimState {
  id: string;
  lat: number;
  lng: number;
  phase: Phase;
  bookingId: string | null;
  pickup: { lat: number; lng: number } | null;
  dest: { lat: number; lng: number } | null;
  wander: { lat: number; lng: number };
  phaseUntil: number;
}

const TICK_MS = 2000;
const ACCEPT_PROBABILITY = 0.9;

function metersToLatLng(meters: number, atLat: number) {
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((atLat * Math.PI) / 180));
  return { dLat, dLng };
}

export class Simulator {
  private dispatcher: Dispatcher;
  private realDrivers: Set<string>;
  private centerLat: number;
  private centerLng: number;
  private states = new Map<string, SimState>();
  private timer: NodeJS.Timeout | null = null;

  constructor(dispatcher: Dispatcher, realDrivers: Set<string>) {
    this.dispatcher = dispatcher;
    this.realDrivers = realDrivers;
    this.centerLat = Number(process.env.DEFAULT_LAT ?? 52.520008);
    this.centerLng = Number(process.env.DEFAULT_LNG ?? 13.404954);
  }

  private randomNear(spread = 0.025) {
    return {
      lat: this.centerLat + (Math.random() - 0.5) * spread * 2,
      lng: this.centerLng + (Math.random() - 0.5) * spread * 2,
    };
  }

  async start(): Promise<void> {
    const drivers = await prisma.driver.findMany();
    for (const d of drivers) {
      const lat = d.lat ?? this.centerLat;
      const lng = d.lng ?? this.centerLng;
      this.states.set(d.id, {
        id: d.id,
        lat,
        lng,
        phase: "idle",
        bookingId: null,
        pickup: null,
        dest: null,
        wander: this.randomNear(),
        phaseUntil: 0,
      });
    }

    // Dispatcher ueber Angebote an virtuelle Fahrer informieren.
    this.dispatcher.onOffer = (bookingId, driverId) => {
      this.handleOffer(bookingId, driverId).catch(() => {});
    };

    // Virtuelle Fahrer initial FREI + online setzen.
    for (const s of this.states.values()) {
      if (this.realDrivers.has(s.id)) continue;
      await this.dispatcher.updateLocation(s.id, s.lat, s.lng);
      await this.dispatcher.setStatus(s.id, "FREI");
    }

    this.timer = setInterval(() => this.tick().catch(() => {}), TICK_MS);
    console.log("  GPS-Simulator gestartet (virtuelle Fahrer aktiv).");
  }

  private async handleOffer(bookingId: string, driverId: string): Promise<void> {
    if (this.realDrivers.has(driverId)) return; // echter Fahrer entscheidet selbst
    const s = this.states.get(driverId);
    if (!s) return;
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return;

    // Kurze "Bedenkzeit", dann an-/ablehnen.
    const delay = 1500 + Math.random() * 4000;
    s.phase = "offered";
    s.phaseUntil = Date.now() + delay;
    s.bookingId = bookingId;
    s.pickup = { lat: booking.pickupLat, lng: booking.pickupLng };
    s.dest = { lat: booking.destLat, lng: booking.destLng };

    setTimeout(async () => {
      if (s.phase !== "offered" || s.bookingId !== bookingId) return;
      const accept = Math.random() < ACCEPT_PROBABILITY;
      const r = await this.dispatcher.respondToOffer(driverId, bookingId, accept);
      if (accept && r.ok) {
        s.phase = "toPickup";
      } else {
        s.phase = "idle";
        s.bookingId = null;
        s.pickup = null;
        s.dest = null;
      }
    }, delay);
  }

  // Bewegt eine Position um stepMeters Richtung target; gibt true bei Ankunft.
  private moveToward(s: SimState, target: { lat: number; lng: number }, stepMeters: number): boolean {
    const dist = haversineMeters({ lat: s.lat, lng: s.lng }, target);
    if (dist <= stepMeters) {
      s.lat = target.lat;
      s.lng = target.lng;
      return true;
    }
    const frac = stepMeters / dist;
    s.lat += (target.lat - s.lat) * frac;
    s.lng += (target.lng - s.lng) * frac;
    return false;
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const s of this.states.values()) {
      if (this.realDrivers.has(s.id)) continue; // echter Fahrer -> nicht simulieren

      if (s.phase === "idle") {
        if (this.moveToward(s, s.wander, 50)) {
          s.wander = this.randomNear();
        }
      } else if (s.phase === "offered") {
        // wartet auf Entscheidung – Position halten
      } else if (s.phase === "toPickup" && s.pickup) {
        if (this.moveToward(s, s.pickup, 180)) {
          s.phase = "atPickup";
          s.phaseUntil = now + 4000;
          if (s.bookingId) await this.dispatcher.tripAction(s.id, s.bookingId, "arrived");
        }
      } else if (s.phase === "atPickup") {
        if (now >= s.phaseUntil && s.bookingId) {
          await this.dispatcher.tripAction(s.id, s.bookingId, "start");
          s.phase = "toDest";
        }
      } else if (s.phase === "toDest" && s.dest) {
        if (this.moveToward(s, s.dest, 200)) {
          if (s.bookingId) await this.dispatcher.tripAction(s.id, s.bookingId, "complete");
          s.phase = "idle";
          s.bookingId = null;
          s.pickup = null;
          s.dest = null;
          s.wander = this.randomNear();
        }
      }

      // Position immer melden (Live-Karte + Kunden-Tracking).
      await this.dispatcher.updateLocation(s.id, s.lat, s.lng);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
