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

/**
 * Client-IP aus dem Forwarded-Header.
 *
 * SICHERHEIT: Frueher wurde das ERSTE Element von `x-forwarded-for` genommen.
 * Proxys haengen ihre Angaben aber HINTEN an – das erste Element stammt damit
 * vom Aufrufer selbst und ist frei waehlbar. Mit `X-Forwarded-For: 127.0.0.1`
 * lieferte diese Funktion `null`, und die Aufrufer uebersprangen daraufhin ihr
 * Limit vollstaendig: Anmelde-Bruteforce, SMS-Versand (echte Twilio-Kosten),
 * Buchungs- und SOS-Spam waren damit ungebremst.
 *
 * Deshalb wird jetzt von RECHTS gezaehlt: der letzte Eintrag stammt vom
 * naechstgelegenen Proxy und ist vertrauenswuerdig. Stehen mehrere Proxys
 * davor, gibt TRUSTED_PROXY_HOPS an, wie viele uebersprungen werden.
 */
export function clientIp(req: Request): string | null {
  const kette = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? 1));
  // Von rechts: der letzte Eintrag ist der eigene Proxy, davor der Client.
  const kandidat = kette.length ? kette[Math.max(0, kette.length - hops)] : "";

  const raw = (kandidat || req.headers.get("x-real-ip") || "").trim();
  if (!raw || isLoopback(raw)) return null;
  return raw;
}

/**
 * Schluessel fuer ein Limit, das IMMER greifen muss – auch wenn keine IP
 * feststellbar ist. Ohne das liesse sich jedes IP-Limit dadurch aushebeln,
 * dass man die IP unkenntlich macht.
 */
export function clientKey(req: Request): string {
  return clientIp(req) ?? "ohne-ip";
}
