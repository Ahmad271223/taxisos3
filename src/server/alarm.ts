// Alarmierung: dafuer sorgen, dass eine Stoerung jemandem AUFFAELLT.
//
// Vorher gab es nichts davon. Fiel Stripe aus, blieben Fahrten unbezahlt
// liegen; fiel Twilio aus, kamen keine Bestaetigungen an; fand die Vermittlung
// keinen Fahrer, wartete der Fahrgast ins Leere. Gemerkt hat das nur, wer
// zufaellig ins Protokoll geschaut hat oder wen ein Kunde angerufen hat.
//
// Bewusst OHNE feste Abhaengigkeit zu einem Anbieter:
//   1. Protokoll  – immer, in einer Form, die sich greppen laesst.
//   2. Webhook    – ALARM_WEBHOOK_URL (Slack, Discord, n8n, was auch immer).
//   3. E-Mail     – ALARM_EMAIL ueber den bereits vorhandenen Resend-Weg.
//   4. Sentry     – nur wenn SENTRY_DSN gesetzt UND @sentry/node installiert
//                   ist. Ohne das Paket passiert schlicht nichts.
//
// Zwei Eigenschaften sind wichtiger als Vollstaendigkeit:
//   - Ein Alarm darf NIEMALS den Aufrufer stoeren. Alles ist gekapselt, es
//     wird nie geworfen, und es wird nicht auf den Versand gewartet.
//   - Ein dauerhaft kaputter Dienst darf nicht dauerhaft alarmieren. Gleiche
//     Meldungen werden zusammengefasst; nach dem Fenster kommt eine
//     Wiederholung MIT Anzahl der unterdrueckten Faelle.

// KEIN fester Import von "../lib/notify": jenes Modul meldet seinerseits
// Alarme, und ein gegenseitiger Import waere ein Kreis. Der Mailversand wird
// deshalb erst im Bedarfsfall geladen.

export type Stufe = "info" | "warnung" | "kritisch";

const RANG: Record<Stufe, number> = { info: 1, warnung: 2, kritisch: 3 };

const MIN_STUFE = (process.env.ALARM_MIN_STUFE as Stufe) || "warnung";
const DEDUPE_MS = Number(process.env.ALARM_DEDUPE_MS ?? 15 * 60_000);
const WEBHOOK = process.env.ALARM_WEBHOOK_URL || "";
const EMAIL = process.env.ALARM_EMAIL || "";

interface Eintrag {
  zuletzt: number;
  unterdrueckt: number;
}
const gesehen = new Map<string, Eintrag>();

/** Verhindert, dass der Speicher bei vielen verschiedenen Schluesseln waechst. */
function aufraeumen(jetzt: number): void {
  if (gesehen.size < 500) return;
  for (const [k, v] of gesehen) {
    if (jetzt - v.zuletzt > DEDUPE_MS * 4) gesehen.delete(k);
  }
}

let sentryPromise: Promise<any> | null = null;
/**
 * Sentry nur laden, wenn es tatsaechlich verwendet werden soll. So bleibt das
 * Paket eine OPTION (`npm i @sentry/node`) und keine Voraussetzung.
 */
async function sentry(): Promise<any> {
  if (!process.env.SENTRY_DSN) return null;
  if (!sentryPromise) {
    sentryPromise = (async () => {
      try {
        // Variable Kennung, damit Bundler es nicht fest einbauen.
        const name = "@sentry/node";
        const mod: any = await import(/* webpackIgnore: true */ name);
        mod.init({
          dsn: process.env.SENTRY_DSN,
          environment: process.env.NODE_ENV ?? "development",
          tracesSampleRate: 0,
        });
        console.log("Alarm: Sentry angebunden.");
        return mod;
      } catch {
        console.warn(
          "Alarm: SENTRY_DSN ist gesetzt, aber @sentry/node fehlt. " +
            "Mit `npm i @sentry/node` nachruesten – bis dahin laufen die " +
            "uebrigen Alarmwege ganz normal weiter.",
        );
        return null;
      }
    })();
  }
  return sentryPromise;
}

function zeile(stufe: Stufe, titel: string, details?: Record<string, unknown>): string {
  const teile = details
    ? Object.entries(details)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
    : "";
  return `[ALARM:${stufe}] ${titel}${teile ? " · " + teile : ""}`;
}

/**
 * Einen Alarm ausloesen.
 *
 * @param stufe     info | warnung | kritisch
 * @param schluessel Stabiler Bezeichner fuer die Zusammenfassung, z. B.
 *                   "zahlung-fehlgeschlagen". NICHT die Auftrags-ID
 *                   hineinschreiben – sonst greift die Zusammenfassung nie.
 * @param titel     Klartext fuer den Menschen, der geweckt wird.
 * @param details   Zusatzangaben (Auftrag, Firma, Fehlertext).
 */
export function alarm(
  stufe: Stufe,
  schluessel: string,
  titel: string,
  details?: Record<string, unknown>,
): void {
  try {
    if (RANG[stufe] < RANG[MIN_STUFE]) return;

    const jetzt = Date.now();
    aufraeumen(jetzt);
    const vorher = gesehen.get(schluessel);
    if (vorher && jetzt - vorher.zuletzt < DEDUPE_MS) {
      vorher.unterdrueckt += 1;
      return;
    }
    const unterdrueckt = vorher?.unterdrueckt ?? 0;
    gesehen.set(schluessel, { zuletzt: jetzt, unterdrueckt: 0 });

    const volleDetails = {
      ...(details ?? {}),
      ...(unterdrueckt > 0 ? { weitereFaelle: unterdrueckt } : {}),
    };

    // 1. Protokoll – immer, auch wenn alle anderen Wege fehlen.
    const text = zeile(stufe, titel, volleDetails);
    if (stufe === "kritisch") console.error(text);
    else console.warn(text);

    // Ab hier: nichts davon darf den Aufrufer aufhalten.
    void verteilen(stufe, schluessel, titel, volleDetails).catch(() => {});
  } catch {
    /* Ein Fehler in der Alarmierung darf den Betrieb nicht stoeren. */
  }
}

async function verteilen(
  stufe: Stufe,
  schluessel: string,
  titel: string,
  details: Record<string, unknown>,
): Promise<void> {
  const zeitpunkt = new Date().toISOString();

  if (WEBHOOK) {
    // `text` versteht Slack und Discord gleichermassen; die uebrigen Felder
    // sind fuer Empfaenger gedacht, die das JSON auswerten.
    const koerper = {
      text: `${stufe === "kritisch" ? "🔴" : "🟠"} ${titel}`,
      stufe,
      schluessel,
      zeitpunkt,
      details,
    };
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(koerper),
    }).catch((e) => console.warn("Alarm-Webhook nicht erreichbar:", e?.message ?? e));
  }

  if (EMAIL && stufe === "kritisch") {
    // Bewusst nur bei "kritisch": eine Mailflut liest am Ende niemand mehr.
    const liste = Object.entries(details)
      .map(([k, v]) => `<li><b>${k}:</b> ${typeof v === "string" ? v : JSON.stringify(v)}</li>`)
      .join("");
    const { sendEmail } = await import("../lib/notify");
    await sendEmail(
      EMAIL,
      `[TaxiOS] ${titel}`,
      `<p><b>${titel}</b></p><p>Stufe: ${stufe}<br>Zeitpunkt: ${zeitpunkt}</p><ul>${liste}</ul>`,
    ).catch(() => null);
  }

  const s = await sentry();
  if (s) {
    s.captureMessage(titel, {
      level: stufe === "kritisch" ? "error" : "warning",
      tags: { schluessel },
      extra: details,
    });
  }
}

/** Beim Start einmal sagen, ob ueberhaupt jemand die Alarme empfaengt. */
export function alarmStatus(): void {
  const wege = [
    WEBHOOK ? "Webhook" : null,
    EMAIL ? "E-Mail" : null,
    process.env.SENTRY_DSN ? "Sentry" : null,
  ].filter(Boolean);

  if (wege.length === 0) {
    // Kein Fehler, aber im Echtbetrieb ein ernstes Risiko: Alarme landen dann
    // ausschliesslich im Protokoll, das niemand dauerhaft beobachtet.
    const hinweis =
      "Alarme gehen NUR ins Protokoll. Es ist kein ALARM_WEBHOOK_URL, " +
      "kein ALARM_EMAIL und kein SENTRY_DSN gesetzt – eine Stoerung faellt " +
      "damit nur auf, wenn jemand zufaellig hinschaut.";
    if (process.env.NODE_ENV === "production") console.error("ACHTUNG: " + hinweis);
    else console.log("Hinweis: " + hinweis);
    return;
  }
  console.log(`Alarmwege aktiv: ${wege.join(", ")} (ab Stufe "${MIN_STUFE}").`);
}
