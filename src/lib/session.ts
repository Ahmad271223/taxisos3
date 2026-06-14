import { cookies } from "next/headers";
import {
  verifySession,
  SESSION_COOKIE,
  ADMIN_COOKIE,
  DRIVER_COOKIE,
  CUSTOMER_COOKIE,
  type SessionPayload,
  type Role,
} from "./auth";

// Liest die Session aus dem rollen-passenden Cookie. `kind` wählt den Bereich;
// ohne `kind` werden Admin -> Fahrer -> Kunde -> Legacy der Reihe nach probiert.
export function getSession(kind?: "admin" | "driver" | "customer"): SessionPayload | null {
  const jar = cookies();
  const read = (name: string) => verifySession(jar.get(name)?.value);
  if (kind === "driver") return read(DRIVER_COOKIE) ?? read(SESSION_COOKIE);
  if (kind === "admin") return read(ADMIN_COOKIE) ?? read(SESSION_COOKIE);
  if (kind === "customer") return read(CUSTOMER_COOKIE);
  return read(ADMIN_COOKIE) ?? read(DRIVER_COOKIE) ?? read(CUSTOMER_COOKIE) ?? read(SESSION_COOKIE);
}

export function requireRole(role: Role): SessionPayload | null {
  const kind = role === "DRIVER" ? "driver" : role === "CUSTOMER" ? "customer" : "admin";
  const s = getSession(kind);
  if (!s || s.role !== role) return null;
  return s;
}
