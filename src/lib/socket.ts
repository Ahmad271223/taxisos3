"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

// Eine einzige Socket-Verbindung pro Browser-Tab. `role` sagt dem Server,
// welche Rolle diese Verbindung bedient (admin/driver) – nötig, damit Admin
// und Fahrer parallel eingeloggt sein können (rollen-getrennte Cookies).
// Ohne role = Kunde (nur Tracking/Chat). Der erste Aufruf bestimmt die Rolle.
export function getSocket(role?: "admin" | "driver"): Socket {
  if (!socket) {
    socket = io({
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      auth: role ? { role } : {},
    });
  }
  return socket;
}
