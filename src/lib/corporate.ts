// QR-Firmenmobilität: Helfer für Mobilitäts-Codes (Firmenkonto übernimmt Fahrten).
// Ein Code wird als QR ausgegeben; Gäste/Mitarbeiter scannen ihn und buchen
// Fahrten, die das Firmenkonto deckt – begrenzt über Budget, Anzahl und Max-Betrag.

export interface CorporateCodeLike {
  code: string;
  active: boolean;
  budgetCents: number | null;
  maxRides: number | null;
  perRideCents: number | null;
  validUntil: string | null;
  usedRides: number;
  usedCents: number;
}

// Eindeutiger, gut lesbarer Code (kein 0/O/1/I, um Verwechslungen am Telefon /
// beim Abtippen zu vermeiden). 8 Zeichen -> ausreichend Entropie.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateCorporateCode(len = 8): string {
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export function normalizeCorporateCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function expired(validUntil: string | null): boolean {
  if (!validUntil) return false;
  // Gültig bis einschließlich dieses Tages.
  const end = new Date(`${validUntil}T23:59:59`);
  return Number.isFinite(end.getTime()) && Date.now() > end.getTime();
}

export interface RemainingInfo {
  remainingCents: number | null; // null = unbegrenzt
  remainingRides: number | null; // null = unbegrenzt
}

export function corporateRemaining(c: CorporateCodeLike): RemainingInfo {
  return {
    remainingCents: c.budgetCents == null ? null : Math.max(0, c.budgetCents - c.usedCents),
    remainingRides: c.maxRides == null ? null : Math.max(0, c.maxRides - c.usedRides),
  };
}

export interface UsableResult {
  ok: boolean;
  reason?: "INACTIVE" | "EXPIRED" | "NO_RIDES" | "OVER_PER_RIDE" | "OVER_BUDGET";
}

// Reine Eignungsprüfung (ohne Fahrpreis): wird der Code grundsätzlich akzeptiert?
export function corporateAvailable(c: CorporateCodeLike): UsableResult {
  if (!c.active) return { ok: false, reason: "INACTIVE" };
  if (expired(c.validUntil)) return { ok: false, reason: "EXPIRED" };
  const r = corporateRemaining(c);
  if (r.remainingRides != null && r.remainingRides <= 0) return { ok: false, reason: "NO_RIDES" };
  if (r.remainingCents != null && r.remainingCents <= 0) return { ok: false, reason: "OVER_BUDGET" };
  return { ok: true };
}

// Eignungsprüfung inkl. konkretem Fahrpreis (Cent): reicht Budget + Pro-Fahrt-Limit?
export function corporateUsable(c: CorporateCodeLike, fareCents: number): UsableResult {
  const base = corporateAvailable(c);
  if (!base.ok) return base;
  if (c.perRideCents != null && fareCents > c.perRideCents) return { ok: false, reason: "OVER_PER_RIDE" };
  const r = corporateRemaining(c);
  if (r.remainingCents != null && fareCents > r.remainingCents) return { ok: false, reason: "OVER_BUDGET" };
  return { ok: true };
}

export function corporateReasonText(reason: UsableResult["reason"]): string {
  switch (reason) {
    case "INACTIVE": return "Dieser Firmen-Code ist deaktiviert.";
    case "EXPIRED": return "Dieser Firmen-Code ist abgelaufen.";
    case "NO_RIDES": return "Das Fahrten-Kontingent dieses Codes ist aufgebraucht.";
    case "OVER_PER_RIDE": return "Diese Fahrt überschreitet das Pro-Fahrt-Limit des Firmen-Codes.";
    case "OVER_BUDGET": return "Das Budget dieses Firmen-Codes reicht für diese Fahrt nicht aus.";
    default: return "Dieser Firmen-Code ist nicht gültig.";
  }
}
