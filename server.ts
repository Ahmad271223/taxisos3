// Custom-Server: Next.js + Express + Socket.IO + Dispatch-Engine in EINEM
// Prozess. Start: npm run dev
import "./src/server/env"; // muss zuerst stehen (laedt .env)

import { createServer } from "http";
import express from "express";
import next from "next";
import { Server as IOServer } from "socket.io";

import { Dispatcher } from "./src/server/dispatch";
import { registerSockets } from "./src/server/realtime";
import { Simulator } from "./src/server/simulator";
import { setRuntime } from "./src/server/runtime";
import { assertLiveReady } from "./src/server/liveGuard";
import { scheduleDailyPlatformRate, scheduleFlightPolling, scheduleRecurringRides, scheduleRideReminders, scheduleRideSettlement } from "./src/server/scheduler";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

// Vor allem anderen: darf dieser Server ueberhaupt im Echtbetrieb laufen?
assertLiveReady();

async function main() {
  const nextApp = next({ dev });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const app = express();
  const httpServer = createServer(app);
  // CORS für Socket.IO: in Produktion auf ALLOWED_ORIGINS einschränken
  // (Komma-getrennt). Ohne Angabe (Dev) jede Herkunft erlauben.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const io = new IOServer(httpServer, {
    cors: { origin: allowedOrigins.length ? allowedOrigins : true, credentials: true },
  });

  // Dispatch-Engine initialisieren und global verfuegbar machen.
  const dispatcher = new Dispatcher(io);
  await dispatcher.init();
  setRuntime({ io, dispatcher });

  const realDrivers = new Set<string>();
  registerSockets(io, dispatcher, realDrivers);

  // Täglicher 02:00-Lauf: Plattform-Durchschnittstarif für den „ca."-Vorabpreis.
  scheduleDailyPlatformRate();

  // Flughafen-Modul: Flüge regelmäßig auf Verspätung prüfen und Abholzeit anpassen.
  scheduleFlightPolling(dispatcher);

  // Krankenfahrten: wiederkehrende Serien stündlich vorausplanen.
  scheduleRecurringRides();

  // Fahrt-Erinnerungen (24h/2h/30min vor der Fahrt).
  scheduleRideReminders();
  scheduleRideSettlement();

  // GPS-Simulator (optional, fuer Demo ohne echte Smartphones).
  if (process.env.ENABLE_SIMULATOR === "1") {
    const sim = new Simulator(dispatcher, realDrivers);
    await sim.start();
  }

  // Alle uebrigen Requests an Next.js durchreichen.
  app.all("*", (req, res) => handle(req, res));

  httpServer.listen(port, () => {
    console.log(`\n  ➜  TaxiOS läuft auf http://localhost:${port}`);
    console.log(`     Plattform/Registrierung: http://localhost:${port}/`);
    console.log(`     Fahrer-Login:            http://localhost:${port}/fahrer/login`);
    console.log(`     Firmen-Login:            http://localhost:${port}/admin/login\n`);
  });
}

main().catch((err) => {
  console.error("Serverstart fehlgeschlagen:", err);
  process.exit(1);
});
