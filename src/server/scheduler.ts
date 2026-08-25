// Tages-Scheduler: berechnet jeden Tag um 02:00 (lokale Zeit) den
// Plattform-Durchschnittstarif neu. Beim Start wird zudem sichergestellt, dass
// ein Wert existiert bzw. ein veralteter (>24 h) sofort aktualisiert wird.

import { computePlatformRate, getPlatformRate } from "../lib/platformRate";
import { prisma } from "../lib/prisma";
import { lookupFlight, airportPickupTime } from "../lib/flights";
import { materializeDueRides } from "../lib/recurring";
import { sendDueReminders } from "../lib/reminders";
import { sendSms } from "../lib/notify";
import { settleDueRides, TIP_WINDOW_MS } from "../lib/settle";
import type { Dispatcher } from "./dispatch";

import { retentionLauf, berichtAusgeben } from "./retention";
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

// --- Loeschkonzept: taeglicher Lauf um 03:00 -------------------------------
//
// Bewusst NACH dem PlatformRate-Lauf (02:00) und in der Nacht: die Loeschungen
// laufen ueber grosse Tabellen und sollen den Tagesbetrieb nicht bremsen.
export function scheduleRetention(): void {
  if (process.env.RETENTION_AKTIV === "0") {
    // Ausdruecklich melden statt still nichts zu tun: ein abgeschaltetes
    // Loeschkonzept ist ein Datenschutzverstoss, der niemandem auffallen darf.
    console.warn(
      "Loeschkonzept ist ABGESCHALTET (RETENTION_AKTIV=0). Es werden keine " +
        "Daten nach Ablauf ihrer Frist entfernt.",
    );
    return;
  }

  const run = async () => {
    try {
      berichtAusgeben(await retentionLauf(false));
    } catch (e) {
      console.error("Loeschlauf fehlgeschlagen:", e);
    }
    setInterval(() => {
      retentionLauf(false).then(berichtAusgeben).catch((e) => console.error("Loeschlauf fehlgeschlagen:", e));
    }, DAY_MS);
  };

  // Beim Start bestaetigen, dass der Lauf scharf ist. Ein eingeplanter, aber
  // nie ausgefuehrter Loeschlauf faellt sonst erst auf, wenn jemand danach
  // fragt – und dann ist die Frist laengst ueberschritten.
  const inStunden = Math.round(msUntilNext(3, 0) / 3_600_000);
  console.log(`  Loeschkonzept aktiv – naechster Lauf in ca. ${inStunden} h (taeglich 03:00).`);
  setTimeout(run, msUntilNext(3, 0));
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
// Jede Fahrt loest eine EINZELNE, kostenpflichtige Flugabfrage aus. Ohne
// Obergrenze wuerde ein Grossereignis am Flughafen sowohl das Kontingent des
// Anbieters als auch diesen Prozess sprengen. Der Lauf wiederholt sich alle
// 10 Minuten, die zeitlich naechsten Fahrten zuerst.
const FLUG_DECKEL = Number(process.env.FLIGHT_BATCH ?? 200);

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
    orderBy: { scheduledAt: "asc" },
    take: FLUG_DECKEL,
  });
  if (bookings.length === FLUG_DECKEL) {
    console.warn(`Flugabfrage: Obergrenze von ${FLUG_DECKEL} erreicht – der Rest folgt im naechsten Lauf.`);
  }
  for (const b of bookings) {
    try {
      const info = await lookupFlight(b.flightNumber!, "ARRIVAL");
      // Ohne Flugdaten-Zugang liefert lookupFlight erfundene Demo-Werte. Damit
      // duerfen im Echtbetrieb NIEMALS Abholzeiten verschoben oder – schlimmer –
      // Fahrten storniert werden. Im Testbetrieb bleibt es fuer die QA aktiv.
      if (info.source === "mock" && process.env.NODE_ENV === "production") continue;
      const changed = info.delayMinutes !== (b.flightDelayMinutes ?? 0) || info.status !== b.flightStatus;
      if (!changed) continue;

      // Annullierter Flug: Fahrt stornieren statt den Fahrer zu einem Flug
      // zu schicken, der nie landet. Kunde wird per SMS informiert.
      if (info.status === "CANCELLED") {
        await prisma.booking.update({
          where: { id: b.id },
          data: { flightStatus: "CANCELLED", status: "STORNIERT", trackingStatus: "STORNIERT" },
        });
        sendSms(
          b.customerPhone,
          `Ihr Flug ${b.flightNumber} wurde annulliert – wir haben die Taxifahrt storniert. Buchen Sie bei Bedarf einfach neu.`,
          { dedupeKey: `flight-cancelled:${b.id}`, kind: "FLIGHT_CANCELLED", bookingId: b.id },
        ).catch(() => {});
        await dispatcher.refreshBooking(b.id);
        continue;
      }

      // Basis ist immer die urspruenglich geplante Landung -> keine kumulative
      // Drift. Ist der Flug bereits gelandet, zaehlt die tatsaechliche Landezeit.
      const base = info.status === "LANDED" && info.actualAt ? new Date(info.actualAt) : b.flightScheduledAt!;
      const delayForCalc = info.status === "LANDED" && info.actualAt ? 0 : info.delayMinutes;
      const newScheduled = airportPickupTime(base, "ARRIVAL", delayForCalc);
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
  // Ueberlappungsschutz: ein langsamer Lauf darf den naechsten nicht doppelt
  // starten (sonst doppelte Updates/SMS).
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await pollFlights(dispatcher);
    } catch {
      /* Lauf darf nie den Scheduler stoppen */
    } finally {
      running = false;
    }
  };
  setInterval(run, FLIGHT_POLL_MS);
  run(); // auch direkt beim Start einmal pruefen
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
  // Ueberlappungsschutz: dauert ein Lauf laenger als das Intervall, wuerde der
  // naechste dieselben faelligen Erinnerungen erneut verschicken (Doppel-SMS).
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const n = await sendDueReminders();
      if (n > 0) console.log(`  Erinnerungen: ${n} gesendet.`);
    } catch (e) {
      console.error("Reminder-Lauf fehlgeschlagen:", e);
    } finally {
      running = false;
    }
  };
  run().catch(() => {}); // beim Boot
  setInterval(() => run().catch(() => {}), REMINDER_POLL_MS);
}

// --- Automatische Abrechnung nach Fahrtende --------------------------------
// Reagiert der Kunde nicht innerhalb des Trinkgeld-Fensters, wird der
// Fahrpreis OHNE Trinkgeld abgebucht. So bleibt keine beendete Fahrt unbezahlt,
// nur weil jemand die Seite geschlossen hat.
const SETTLE_POLL_MS = Math.max(15_000, Math.min(30_000, Math.round(TIP_WINDOW_MS / 4)));

export function scheduleRideSettlement(): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const n = await settleDueRides();
      if (n > 0) console.log(`  Zahlungen: ${n} Fahrt(en) automatisch abgerechnet (ohne Trinkgeld).`);
    } catch (e) {
      console.error("Abrechnungslauf fehlgeschlagen:", e);
    } finally {
      running = false;
    }
  };
  run().catch(() => {});
  setInterval(() => run().catch(() => {}), SETTLE_POLL_MS);
}
