// SMS- (Twilio) und E-Mail-Versand (Resend) – Phase 3h.
//
// Wie bei Stripe (src/lib/stripe.ts) werden die SDKs nur dynamisch geladen,
// wenn die jeweiligen Credentials gesetzt sind. Fehlen sie, laeuft alles im
// MOCK-Modus: der Code/die Mail wird lediglich geloggt und (bei SMS) als
// `devCode` zurueckgegeben, sodass der Flow lokal und in CI ohne Provider
// vollstaendig testbar bleibt.

type AnyClient = any;

let twilioPromise: Promise<AnyClient | null> | null = null;
let resendPromise: Promise<AnyClient | null> | null = null;

// Authentifizierung: API-Key (SK…/Secret, empfohlen) ODER Auth-Token.
function hasTwilioAuth(): boolean {
  return !!(process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET) || !!process.env.TWILIO_AUTH_TOKEN;
}

// Absender: Messaging-Service-SID (MG…) ODER Twilio-Nummer (E.164).
function smsSender(): { messagingServiceSid: string } | { from: string } | null {
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) return { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID };
  if (process.env.TWILIO_FROM) return { from: process.env.TWILIO_FROM };
  return null;
}

export function smsEnabled(): boolean {
  // Not-Aus fuer Tests/Lastlaeufe: verhindert, dass echte SMS (und damit
  // Kosten bzw. das Tageskontingent) durch automatisierte Tests verbraucht
  // werden. Der komplette Code-Pfad laeuft weiter, nur der Versand ist Mock.
  if (process.env.SMS_DISABLED === "1") return false;
  return !!(process.env.TWILIO_ACCOUNT_SID && hasTwilioAuth() && smsSender());
}

export function emailEnabled(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

async function getTwilio(): Promise<AnyClient | null> {
  if (!smsEnabled()) return null;
  if (!twilioPromise) {
    twilioPromise = import("twilio")
      .then((m: any) => {
        const Twilio = m.default ?? m;
        const accountSid = process.env.TWILIO_ACCOUNT_SID as string;
        // API-Key bevorzugen (revozierbar); sonst klassischer Auth-Token.
        if (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET) {
          return Twilio(process.env.TWILIO_API_KEY_SID, process.env.TWILIO_API_KEY_SECRET, { accountSid });
        }
        return Twilio(accountSid, process.env.TWILIO_AUTH_TOKEN as string);
      })
      .catch(() => null);
  }
  return twilioPromise;
}

async function getResend(): Promise<AnyClient | null> {
  if (!emailEnabled()) return null;
  if (!resendPromise) {
    resendPromise = import("resend")
      .then((m: any) => {
        const Resend = m.Resend ?? m.default ?? m;
        return new Resend(process.env.RESEND_API_KEY as string);
      })
      .catch(() => null);
  }
  return resendPromise;
}

export interface SendResult {
  ok: boolean;
  mock: boolean;
  id?: string | null;
  error?: string;
  // true = wurde wegen Doppelversand-Sperre nicht erneut gesendet
  deduped?: boolean;
}

// Telefonnummer nach E.164 normalisieren. Twilio lehnt alles andere mit
// Fehler 21211 ("Invalid To Phone Number") ab – deutsche Nummern werden in der
// Praxis fast immer als "0511 123456" / "0176-123 456" eingegeben.
const DEFAULT_COUNTRY_CODE = (process.env.SMS_DEFAULT_COUNTRY_CODE ?? "49").replace(/\D/g, "");

export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s || s === "—") return null;
  // Internationale Schreibweise 00.. -> +..
  s = s.replace(/^00/, "+");
  const plus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  if (plus) return "+" + digits;
  // Fuehrende nationale 0 durch die Landesvorwahl ersetzen.
  if (digits.startsWith("0")) return "+" + DEFAULT_COUNTRY_CODE + digits.replace(/^0+/, "");
  // Bereits mit Landesvorwahl (z. B. "4915112345678")
  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) return "+" + digits;
  return "+" + DEFAULT_COUNTRY_CODE + digits;
}

export interface SmsOptions {
  // Fachlicher Schluessel zur Doppelversand-Sperre, z. B. `driver-cancel:<bookingId>`.
  // Ein zweiter Versand mit demselben Schluessel wird verworfen.
  dedupeKey?: string;
  // Zweck fuer das Protokoll (z. B. "BOOKING_CONFIRMED").
  kind?: string;
  bookingId?: string | null;
}

// Bereits versendete dedupeKeys (Prozess-Speicher). Zusaetzlich wird jede SMS
// in der Tabelle SmsLog protokolliert, die auch prozessuebergreifend sperrt.
const sentKeys = new Set<string>();

export async function sendSms(to: string, body: string, opts: SmsOptions = {}): Promise<SendResult> {
  const target = toE164(to);
  if (!target) {
    console.warn(`[notify] SMS verworfen – ungueltige Nummer: ${JSON.stringify(to)}`);
    return { ok: false, mock: false, error: "invalid_phone" };
  }

  // --- Doppelversand-Sperre -------------------------------------------------
  const key = opts.dedupeKey;
  if (key) {
    if (sentKeys.has(key)) {
      console.log(`[notify] SMS uebersprungen (Duplikat): ${key}`);
      return { ok: true, mock: false, id: null, deduped: true };
    }
    // DB-Sperre: @@unique(dedupeKey) verhindert Doppelversand auch bei
    // parallelen Scheduler-Laeufen oder mehreren Server-Instanzen.
    try {
      const { prisma } = await import("./prisma");
      await prisma.smsLog.create({
        data: { dedupeKey: key, kind: opts.kind ?? null, bookingId: opts.bookingId ?? null, to: target, body: body.slice(0, 500), status: "PENDING" },
      });
    } catch {
      // Unique-Verletzung = eine andere Instanz hat die SMS bereits uebernommen.
      sentKeys.add(key);
      console.log(`[notify] SMS uebersprungen (bereits protokolliert): ${key}`);
      return { ok: true, mock: false, id: null, deduped: true };
    }
    sentKeys.add(key);
  }

  const finish = async (res: SendResult) => {
    if (key) {
      try {
        const { prisma } = await import("./prisma");
        await prisma.smsLog.update({
          where: { dedupeKey: key },
          data: { status: res.ok ? (res.mock ? "MOCK" : "SENT") : "FAILED", providerId: res.id ?? null, error: res.error ?? null },
        });
      } catch {
        /* Protokoll ist best effort */
      }
      // Fehlgeschlagene SMS darf spaeter erneut versucht werden.
      if (!res.ok) sentKeys.delete(key);
    }
    return res;
  };

  const client = await getTwilio();
  if (!client) {
    console.log(`[notify:mock SMS] -> ${target}: ${body}`);
    return finish({ ok: true, mock: true, id: null });
  }
  try {
    const msg = await client.messages.create({ to: target, ...(smsSender() as object), body });
    return finish({ ok: true, mock: false, id: msg.sid });
  } catch (e: any) {
    console.warn(`[notify] SMS an ${target} fehlgeschlagen: ${e?.message}`);
    return finish({ ok: false, mock: false, error: e?.message ?? "twilio_error" });
  }
}

export interface EmailAttachment {
  filename: string;
  content: Buffer; // Roh-Bytes; Resend akzeptiert Buffer/Base64
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[],
): Promise<SendResult> {
  const client = await getResend();
  if (!client) {
    const extra = attachments?.length ? ` (+${attachments.length} Anhang)` : "";
    console.log(`[notify:mock EMAIL] -> ${to}: ${subject}${extra}`);
    return { ok: true, mock: true, id: null };
  }
  try {
    const payload: any = { from: process.env.RESEND_FROM as string, to, subject, html };
    if (attachments?.length) {
      payload.attachments = attachments.map((a) => ({ filename: a.filename, content: a.content }));
    }
    const res = await client.emails.send(payload);
    return { ok: true, mock: false, id: res?.data?.id ?? null };
  } catch (e: any) {
    return { ok: false, mock: false, error: e?.message ?? "resend_error" };
  }
}
