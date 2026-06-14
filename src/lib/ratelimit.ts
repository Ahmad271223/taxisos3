// Einfaches In-Memory-Rate-Limiting (Fixed-Window) – ausreichend für den
// Einzelprozess-Server. Schützt v. a. den SMS-Versand (Twilio-Kosten), Login
// (Brute-Force) und Buchungs-Spam.
//
// WICHTIG: Die Limits greifen nur, wenn die Client-IP bekannt ist (X-Forwarded-
// For vom Proxy/Ingress). Direkte lokale Aufrufe ohne diesen Header (Tests)
// werden NICHT limitiert, damit die Test-Suite deterministisch bleibt.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

export interface RateResult {
  ok: boolean;
  retryAfter: number; // Sekunden bis zum Reset
}

export function rateLimit(key: string, max: number, windowMs: number): RateResult {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (b.count >= max) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  b.count++;
  return { ok: true, retryAfter: 0 };
}

// Client-IP aus dem Forwarded-Header. Null -> keine vertrauenswürdige externe
// Client-IP (lokal/direkt) -> Aufrufer überspringt das IP-Limit.
// Loopback wird ignoriert, weil der Custom-Server lokale Aufrufe mit ::1 /
// 127.0.0.1 markiert; echte Clients kommen hinter dem Proxy mit öffentlicher IP.
function isLoopback(ip: string): boolean {
  return (
    ip === "::1" ||
    ip === "0.0.0.0" ||
    ip.startsWith("127.") ||
    ip.startsWith("::ffff:127.") ||
    ip === "localhost"
  );
}

export function clientIp(req: Request): string | null {
  const raw = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "").trim();
  if (!raw || isLoopback(raw)) return null;
  return raw;
}
