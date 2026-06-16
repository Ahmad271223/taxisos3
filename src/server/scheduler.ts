// Tages-Scheduler: berechnet jeden Tag um 02:00 (lokale Zeit) den
// Plattform-Durchschnittstarif neu. Beim Start wird zudem sichergestellt, dass
// ein Wert existiert bzw. ein veralteter (>24 h) sofort aktualisiert wird.

import { computePlatformRate, getPlatformRate } from "../lib/platformRate";
import { prisma } from "../lib/prisma";
import { lookupFlight, airportPickupTime } from "../lib/flights";
import { materializeDueRides } from "../lib/recurring";
import { sendDueReminders } from "../lib/reminders";
import type { Dispatcher } from "./dispatch";

const DAY_MS = 24 * 60 * 60 * 1000;

function msUntilNext(hour: number, minute = 0): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function ensureFresh(): Promise<void> {
  try {
    const r = await getPlatformRate();
    const ageMs = Date.now() - new Date(r.computedAt).getTime();
    if (ageMs > DAY_MS) await computePlatformRate();
  } catch (e) {
    console.error("PlatformRate ensureFresh fehlgeschlagen:", e);
  }
}

export function scheduleDailyPlatformRate(): void {
  // Beim Boot: Wert sicherstellen/auffrischen.
  ensureFresh().catch(() => {});

  const run = async () => {
    try {
      const r = await computePlatformRate();
      console.log(`  PlatformRate aktualisiert: Ø ${r.avgPerKm} €/km (Basis ${r.avgBasePrice} €, ${r.companyCount} Firmen)`);
    } catch (e) {
      console.error("PlatformRate-Tageslauf fehlgeschlagen:", e);
    }
    setInterval(run, DAY_MS); // danach alle 24 h
  };

  setTimeout(run, msUntilNext(2, 0)); // erster Lauf um 02:00
}

// --- Flughafen-Modul (Phase 14): Verspätungserkennung ----------------------
const FLIGHT_POLL_MS = 10 * 60_000;

async function pollFlights(dispatcher: Dispatcher): Promise<void> {
  const now = Date.now();
  const horizon = new Date(now + DAY_MS);
  // Noch nicht in Disposition befindliche Ankunfts-Flugfahrten der nächsten 24 h.
  const bookings = await prisma.booking.findMany({
    where: {
      status: "OFFEN",
      trackingStatus: "GEPLANT",
      flightDirection: "ARRIVAL",
      flightNumber: { not: null },
      flightScheduledAt: { not: null },
      scheduledAt: { gt: new Date(now), lt: horizon },
    },
  });
  for (const b of bookings) {
    try {
      const info = await lookupFlight(b.flightNumber!, "ARRIVAL");
      const changed = info.delayMinutes !== (b.flightDelayMinutes ?? 0) || info.status !== b.flightStatus;
      if (!changed) continue;
      const newScheduled = airportPickupTime(b.flightScheduledAt!, "ARRIVAL", info.delayMinutes);
      await prisma.booking.update({
        where: { id: b.id },
        data: {
          flightDelayMinutes: info.delayMinutes,
          flightStatus: info.status,
          terminal: info.terminal ?? b.terminal,
          scheduledAt: newScheduled,
        },
      });
      await dispatcher.refreshBooking(b.id);
    } catch {
      /* einzelne Abfrage darf den Lauf nicht stoppen */
    }
  }
}

export function scheduleFlightPolling(dispatcher: Dispatcher): void {
  setInterval(() => pollFlights(dispatcher).catch(() => {}), FLIGHT_POLL_MS);
}

// --- Wiederkehrende (Kranken-)Fahrten (Phase 15): vorausplanen ------------
const RECURRING_POLL_MS = 60 * 60_000; // stündlich

export function scheduleRecurringRides(): void {
  const run = async () => {
    try {
      const n = await materializeDueRides(3);
      if (n > 0) console.log(`  Wiederkehrende Fahrten: ${n} Buchung(en) vorausgeplant.`);
    } catch (e) {
      console.error("Recurring-Materialisierung fehlgeschlagen:", e);
    }
  };
  run().catch(() => {}); // beim Boot
  setInterval(() => run().catch(() => {}), RECURRING_POLL_MS);
}

// --- Fahrt-Erinnerungen (24h/2h/30min) -------------------------------------
const REMINDER_POLL_MS = 5 * 60_000;

export function scheduleRideReminders(): void {
  const run = async () => {
    try {
      const n = await sendDueReminders();
      if (n > 0) console.log(`  Erinnerungen: ${n} gesendet.`);
    } catch (e) {
      console.error("Reminder-Lauf fehlgeschlagen:", e);
    }
  };
  run().catch(() => {}); // beim Boot
  setInterval(() => run().catch(() => {}), REMINDER_POLL_MS);
}
