import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export type Role = "ADMIN" | "DRIVER" | "SUPER_ADMIN" | "CUSTOMER" | "INSTITUTION" | "HOTEL" | "EVENT";

export interface SessionPayload {
  sub: string; // user id (Driver-ID bzw. Company-ID)
  role: Role;
  name: string;
  username: string;
  companyId: string; // Mandant
  companySlug?: string;
  phone?: string; // nur Kundenkonto
  portalRole?: string; // Sub-Nutzer-Rolle im B2B-Portal (Hotel/Event); fehlt = Inhaber
}

// Rollen-getrennte Cookies, damit Admin UND Fahrer gleichzeitig im selben
// Browser eingeloggt sein können. SESSION_COOKIE bleibt als Legacy-Fallback.
export const SESSION_COOKIE = "tc_session";
export const ADMIN_COOKIE = "tc_admin"; // ADMIN + SUPER_ADMIN
export const DRIVER_COOKIE = "tc_driver";
export const CUSTOMER_COOKIE = "tc_customer";
export const INSTITUTION_COOKIE = "tc_institution"; // Einrichtungs-Portal (Phase E)
export const HOTEL_COOKIE = "tc_hotel"; // Hotel-Portal (B2B Mobility)
export const EVENT_COOKIE = "tc_event"; // Event-Portal (Mass Mobility)

export function cookieForRole(role: Role): string {
  if (role === "DRIVER") return DRIVER_COOKIE;
  if (role === "CUSTOMER") return CUSTOMER_COOKIE;
  if (role === "INSTITUTION") return INSTITUTION_COOKIE;
  if (role === "HOTEL") return HOTEL_COOKIE;
  if (role === "EVENT") return EVENT_COOKIE;
  return ADMIN_COOKIE;
}

const DEFAULT_DEV_SECRET = "dev-secret-bitte-aendern";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  // Im Produktivbetrieb darf kein fehlendes/Default-Secret verwendet werden –
  // sonst wären alle Sessions fälschbar. Hart fehlschlagen statt unsicher laufen.
  if (!s || s === DEFAULT_DEV_SECRET || s === "bitte-aendern") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET ist nicht gesetzt – im Produktivbetrieb zwingend erforderlich.");
    }
    return DEFAULT_DEV_SECRET;
  }
  return s;
}

// Prüft – OHNE zu werfen –, ob ein gültiges AUTH_SECRET vorliegt. Erlaubt
// Auth-Routen, bei Fehlkonfiguration früh und klar abzubrechen (statt erst beim
// Signieren mit einem generischen 500). Im Dev gilt der Default als ausreichend.
export function authConfigured(): boolean {
  const s = process.env.AUTH_SECRET;
  if (process.env.NODE_ENV !== "production") return true;
  return !!s && s !== DEFAULT_DEV_SECRET && s !== "bitte-aendern";
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, secret(), { expiresIn: "7d", algorithm: "HS256" });
}

export function verifySession(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  try {
    // Algorithmus festnageln: verhindert "alg: none"/Confusion-Angriffe.
    return jwt.verify(token, secret(), { algorithms: ["HS256"] }) as SessionPayload;
  } catch {
    return null;
  }
}
