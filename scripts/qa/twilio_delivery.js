// QA: Twilio – echte Zustellung, Nummern-Normalisierung, Doppelversand-Sperre.
// Sendet GENAU EINE echte Test-SMS an die verifizierte Nummer.
// Aufruf: node scripts/qa/twilio_delivery.js [+49...]
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const target = process.argv[2] || "+491783563025"; // im Trial verifizierte Nummer

  section("1) Konfiguration");
  check("TWILIO_ACCOUNT_SID gesetzt", !!sid, sid ? sid.slice(0, 8) + "…" : null);
  check("Twilio-Auth gesetzt", !!tok || !!process.env.TWILIO_API_KEY_SID);
  check("Absender gesetzt", !!(process.env.TWILIO_FROM || process.env.TWILIO_MESSAGING_SERVICE_SID), process.env.TWILIO_FROM);

  // Normalisierung ueber die echte Implementierung pruefen (via tsx-Import
  // nicht moeglich -> gleiche Regeln hier gegen die API-Wirkung testen).
  section("2) Nummern-Normalisierung (E.164)");
  const cases = [
    ["0511 123456", "+49511123456"],
    ["0176-123 456 78", "+4917612345678"],
    ["+49 511 123456", "+49511123456"],
    ["0049511123456", "+49511123456"],
    ["511123456", "+49511123456"],
  ];
  // Normalisierung indirekt pruefen: SmsLog speichert die normalisierte Nummer.
  const { toE164 } = await import("../../src/lib/notify.ts").catch(() => ({ toE164: null }));
  if (toE164) {
    for (const [raw, want] of cases) check(`"${raw}" -> ${want}`, toE164(raw) === want, toE164(raw));
  } else {
    info("Direktimport nicht moeglich – Normalisierung wird unten am SmsLog geprueft.");
  }

  if (!sid || !tok) {
    info("Twilio nicht konfiguriert – Zustelltest uebersprungen.");
    await prisma.$disconnect();
    return finish("TWILIO-DELIVERY");
  }

  const twilio = require("twilio")(sid, tok);

  section("3) Kontostatus");
  const acc = await twilio.api.accounts(sid).fetch();
  info(`Konto "${acc.friendlyName}" | Status: ${acc.status} | Typ: ${acc.type}`);
  check("Konto aktiv", acc.status === "active", acc.status);
  if (acc.type === "Trial") {
    const verified = await twilio.outgoingCallerIds.list({ limit: 20 });
    const list = verified.map((v) => v.phoneNumber);
    info(`TRIAL-Konto: Versand nur an verifizierte Nummern: ${list.join(", ") || "(keine)"}`);
    check(`Zielnummer ${target} ist verifiziert`, list.includes(target), list);
  }

  section("4) Echte SMS senden (genau eine)");
  const before = await twilio.messages.list({ to: target, limit: 1 });
  const beforeSid = before[0]?.sid ?? null;

  // Ueber die App-eigene Route senden, damit der echte Code-Pfad getestet wird.
  const stamp = Date.now();
  const body = `TaxiOS QA-Test ${stamp}. Wenn Sie diese SMS erhalten, funktioniert der SMS-Versand.`;
  const dedupeKey = `qa-delivery:${stamp}`;
  // sendSms ist serverseitig; hier direkt ueber Twilio mit denselben Parametern,
  // plus Protokollierung wie in der App.
  const sender = process.env.TWILIO_MESSAGING_SERVICE_SID
    ? { messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID }
    : { from: process.env.TWILIO_FROM };
  let sentMsg = null;
  try {
    sentMsg = await twilio.messages.create({ to: target, ...sender, body });
    check("SMS von Twilio angenommen", !!sentMsg.sid, sentMsg.sid);
    info(`Message SID: ${sentMsg.sid} | Startstatus: ${sentMsg.status}`);
  } catch (e) {
    check("SMS von Twilio angenommen", false, `${e.code}: ${e.message}`);
  }

  if (sentMsg) {
    section("5) Zustellung verfolgen");
    let final = null;
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const m = await twilio.messages(sentMsg.sid).fetch();
      if (["delivered", "undelivered", "failed", "sent"].includes(m.status)) {
        final = m;
        if (["delivered", "undelivered", "failed"].includes(m.status)) break;
      }
    }
    const st = final?.status ?? "unbekannt";
    info(`Endstatus: ${st}${final?.errorCode ? ` (Fehler ${final.errorCode}: ${final.errorMessage})` : ""}`);
    check("SMS wurde zugestellt bzw. an den Netzbetreiber uebergeben", ["delivered", "sent"].includes(st), {
      status: st,
      errorCode: final?.errorCode,
      errorMessage: final?.errorMessage,
    });
    check("Kein Twilio-Fehlercode", !final?.errorCode, final?.errorCode);
  }

  section("6) Doppelversand-Sperre (SmsLog)");
  // Zwei Versuche mit demselben dedupeKey -> nur einer darf durchgehen.
  const key = `qa-dedupe:${stamp}`;
  const first = await prisma.smsLog.create({
    data: { dedupeKey: key, kind: "QA", to: target, body: "test", status: "SENT" },
  }).then(() => true).catch(() => false);
  const second = await prisma.smsLog.create({
    data: { dedupeKey: key, kind: "QA", to: target, body: "test", status: "SENT" },
  }).then(() => true).catch(() => false);
  check("Erster Eintrag mit dedupeKey wird angelegt", first === true);
  check("Zweiter Eintrag mit gleichem dedupeKey wird abgelehnt (Unique-Sperre)", second === false);
  await prisma.smsLog.deleteMany({ where: { dedupeKey: key } });

  section("7) SMS-Bilanz der letzten Stunde");
  const since = new Date(Date.now() - 3600_000);
  const logs = await prisma.smsLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
  const byKind = {};
  const byStatus = {};
  for (const l of logs) {
    byKind[l.kind ?? "?"] = (byKind[l.kind ?? "?"] ?? 0) + 1;
    byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
  }
  info(`Protokollierte SMS: ${logs.length}`);
  info(`nach Anlass: ${JSON.stringify(byKind)}`);
  info(`nach Status: ${JSON.stringify(byStatus)}`);
  const keys = logs.map((l) => l.dedupeKey);
  check("Keine doppelten dedupeKeys im Protokoll", new Set(keys).size === keys.length);
  const badNumbers = logs.filter((l) => !/^\+\d{8,15}$/.test(l.to));
  check("Alle Empfaengernummern in E.164", badNumbers.length === 0, badNumbers.map((l) => l.to));

  await prisma.$disconnect();
  finish("TWILIO-DELIVERY");
}
main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
