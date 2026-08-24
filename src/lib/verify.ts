// Gast-Verifizierung (Phase 3h): Code-Erzeugung, Normalisierung und ein
// kurzlebiges, signiertes "Verifizierungs-Token" als Buchungsnachweis.

import jwt from "jsonwebtoken";

export type VerifyChannel = "SMS" | "EMAIL";

export const CODE_TTL_MS = 10 * 60_000; // 10 Minuten gueltig
export const MAX_ATTEMPTS = 5;
const TOKEN_TTL = "20m"; // Nachweis-Token nach erfolgreicher Verifizierung

const DEFAULT_DEV_SECRET = "dev-secret-bitte-aendern";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  // Dieser Schluessel signiert den Nachweis "Telefonnummer bestaetigt". Mit
  // einem bekannten Standardwert koennte sich jeder diesen Nachweis selbst
  // ausstellen und die Verifizierung komplett umgehen. Im Echtbetrieb daher
  // hart abbrechen statt unsicher weiterlaufen – wie in lib/auth.ts.
  if (!s || s === DEFAULT_DEV_SECRET || s === "bitte-aendern") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET ist nicht gesetzt – im Produktivbetrieb zwingend erforderlich.");
    }
    return DEFAULT_DEV_SECRET;
  }
  return s;
}

// Pflicht-Schalter: Telefon-Verifizierung vor Dispatch. Default AN.
export function phoneVerificationRequired(): boolean {
  return process.env.REQUIRE_PHONE_VERIFICATION !== "0";
}

// Telefon: nur Ziffern + fuehrendes +. E-Mail: trim + lowercase.
export function normalizeTarget(channel: VerifyChannel, raw: string): string {
  const v = (raw ?? "").trim();
  if (channel === "EMAIL") return v.toLowerCase();
  const plus = v.startsWith("+") ? "+" : "";
  return plus + v.replace(/[^0-9]/g, "");
}

export function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-stellig
}

interface VerifyTokenPayload {
  purpose: "verify";
  channel: VerifyChannel;
  target: string;
}

export function signVerifyToken(channel: VerifyChannel, target: string): string {
  const payload: VerifyTokenPayload = { purpose: "verify", channel, target };
  return jwt.sign(payload, secret(), { expiresIn: TOKEN_TTL, algorithm: "HS256" });
}

// Prueft Token + (optional) ob es zum erwarteten Ziel/Kanal passt.
export function verifyVerifyToken(
  token: string | undefined | null,
  expected?: { channel?: VerifyChannel; target?: string },
): VerifyTokenPayload | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret(), { algorithms: ["HS256"] }) as VerifyTokenPayload;
    if (p.purpose !== "verify") return null;
    if (expected?.channel && p.channel !== expected.channel) return null;
    if (expected?.target && p.target !== expected.target) return null;
    return p;
  } catch {
    return null;
  }
}
