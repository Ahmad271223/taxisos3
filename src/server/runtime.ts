// Bruecke zwischen dem Custom-Server (server.ts, via tsx) und den
// Next.js Route-Handlern. Beide laufen im selben Node-Prozess, aber in
// getrennten Modul-Registries. Indem wir die Singletons an globalThis
// haengen, teilen sich beide Seiten dieselbe Dispatcher-/IO-Instanz.

import type { Server as IOServer } from "socket.io";
import type { Dispatcher } from "./dispatch";

interface Runtime {
  io: IOServer;
  dispatcher: Dispatcher;
}

const KEY = "__TAXICONNECT_RUNTIME__";

export function setRuntime(rt: Runtime): void {
  (globalThis as any)[KEY] = rt;
}

export function getRuntime(): Runtime | undefined {
  return (globalThis as any)[KEY];
}

export function getDispatcher(): Dispatcher | undefined {
  return getRuntime()?.dispatcher;
}
