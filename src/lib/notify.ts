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
}

export async function sendSms(to: string, body: string): Promise<SendResult> {
  const client = await getTwilio();
  if (!client) {
    console.log(`[notify:mock SMS] -> ${to}: ${body}`);
    return { ok: true, mock: true, id: null };
  }
  try {
    const msg = await client.messages.create({ to, ...(smsSender() as object), body });
    return { ok: true, mock: false, id: msg.sid };
  } catch (e: any) {
    return { ok: false, mock: false, error: e?.message ?? "twilio_error" };
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
