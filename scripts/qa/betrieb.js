// QA: Betriebsfaehigkeit – Alarmierung, Loeschkonzept, SMS-Sparprofil.
//
// Diese drei Dinge fehlten vollstaendig und sind der Unterschied zwischen
// "laeuft auf dem Rechner" und "kann in Betrieb gehen":
//
//   1. Alarmierung – merkt ueberhaupt jemand, wenn etwas kaputtgeht?
//   2. Loeschkonzept – wird geloescht, was geloescht werden muss?
//   3. SMS-Profil – laesst sich der groesste laufende Kostenblock steuern?
//
// Aufruf: node scripts/qa/betrieb.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function laden() {
  const { register } = require("tsx/cjs/api");
  register();
  return {
    alarm: require("../../src/server/alarm.ts"),
    retention: require("../../src/server/retention.ts"),
    notify: require("../../src/lib/notify.ts"),
  };
}

async function main() {
  const { alarm, retention, notify } = laden();

  // =========================================================================
  section("1) Alarmierung meldet sich und stoert den Betrieb nicht");

  const gesammelt = [];
  const echtWarn = console.warn;
  const echtError = console.error;
  console.warn = (...a) => gesammelt.push(a.join(" "));
  console.error = (...a) => gesammelt.push(a.join(" "));

  try {
    alarm.alarm("kritisch", "qa-test", "QA-Testalarm", { auftrag: "abc123" });
    alarm.alarm("warnung", "qa-test-2", "QA-Warnung");
    // Zusammenfassung: derselbe Schluessel darf nicht erneut melden.
    alarm.alarm("kritisch", "qa-test", "QA-Testalarm", { auftrag: "def456" });
  } finally {
    console.warn = echtWarn;
    console.error = echtError;
  }

  const text = gesammelt.join("\n");
  check("Kritischer Alarm wird protokolliert", /\[ALARM:kritisch\] QA-Testalarm/.test(text));
  check("Details stehen dabei", text.includes("auftrag=abc123"));
  check("Warnung wird protokolliert", /\[ALARM:warnung\] QA-Warnung/.test(text));
  const treffer = (text.match(/QA-Testalarm/g) || []).length;
  check("Wiederholung wird zusammengefasst", treffer === 1, `${treffer} Meldungen`);
  info("Ohne Zusammenfassung wuerde ein dauerhaft kaputter Dienst das Protokoll fluten.");

  // Ein Alarm darf NIE werfen – sonst reisst er den Aufrufer mit.
  let geworfen = false;
  try {
    alarm.alarm("kritisch", "qa-kaputt", "Alarm mit kaputten Details", {
      // Zirkulaere Struktur: JSON.stringify wuerde hier werfen.
      selbst: (() => { const o = {}; o.o = o; return o; })(),
    });
  } catch {
    geworfen = true;
  }
  check("Alarm wirft auch bei kaputten Daten nicht", !geworfen);

  check("Alarmstatus laesst sich abfragen", typeof alarm.alarmStatus === "function");

  // =========================================================================
  section("2) Loeschkonzept: Trockenlauf aendert nichts");

  const vorher = {
    fahrten: await prisma.booking.count(),
    codes: await prisma.verification.count(),
  };
  const bericht = await retention.retentionLauf(true);
  const nachher = {
    fahrten: await prisma.booking.count(),
    codes: await prisma.verification.count(),
  };

  check("Trockenlauf ist als solcher gekennzeichnet", bericht.trocken === true);
  check("Trockenlauf loescht keine Fahrten", vorher.fahrten === nachher.fahrten, `${vorher.fahrten} -> ${nachher.fahrten}`);
  check("Trockenlauf loescht keine Codes", vorher.codes === nachher.codes, `${vorher.codes} -> ${nachher.codes}`);
  check("Bericht nennt alle Posten", Object.keys(bericht.posten).length >= 8, Object.keys(bericht.posten).length);
  check(
    "Fahrten sind standardmaessig geschuetzt",
    Object.keys(bericht.posten).some((k) => k.includes("NICHT geloescht")),
    Object.keys(bericht.posten).join(", "),
  );
  check(
    "Konten sind standardmaessig geschuetzt",
    Object.keys(bericht.posten).some((k) => k.includes("NICHT anonymisiert")),
  );
  info("Fahrten und Konten nur nach ausdruecklicher Freigabe – beides ist unumkehrbar.");

  // =========================================================================
  section("3) SMS-Sparprofil steuert den groessten Kostenblock");

  const vorherProfil = process.env.SMS_PROFIL;
  try {
    process.env.SMS_PROFIL = "voll";
    check("Profil 'voll' wird erkannt", notify.smsProfil() === "voll", notify.smsProfil());
    process.env.SMS_PROFIL = "minimal";
    check("Profil 'minimal' wird erkannt", notify.smsProfil() === "minimal", notify.smsProfil());
    process.env.SMS_PROFIL = "quatsch";
    check("Unbekannter Wert faellt auf 'sparsam' zurueck", notify.smsProfil() === "sparsam", notify.smsProfil());
    delete process.env.SMS_PROFIL;
    check("Standard ist 'sparsam'", notify.smsProfil() === "sparsam", notify.smsProfil());
  } finally {
    if (vorherProfil === undefined) delete process.env.SMS_PROFIL;
    else process.env.SMS_PROFIL = vorherProfil;
  }

  // Im Profil "minimal" darf eine Erinnerung nicht rausgehen, eine
  // Buchungsbestaetigung dagegen schon.
  process.env.SMS_PROFIL = "minimal";
  const erinnerung = await notify.sendSms("+4915100000001", "Erinnerung", { kind: "REMINDER" });
  const bestaetigung = await notify.sendSms("+4915100000002", "Bestaetigung", { kind: "BOOKING_CONFIRMED" });
  check("Erinnerung wird im Sparprofil unterdrueckt", erinnerung.mock === true && erinnerung.id === null);
  check("Buchungsbestaetigung geht weiterhin raus", bestaetigung.ok === true);

  // Die Verifizierungs-SMS hat kein 'kind' und MUSS immer durchgehen.
  const code = await notify.sendSms("+4915100000003", "Ihr Code: 1234");
  check("Bestaetigungscode geht immer raus", code.ok === true);
  info("Ohne den Code kaeme niemand mehr durch die Anmeldung – der darf nie am Profil haengen.");

  if (vorherProfil === undefined) delete process.env.SMS_PROFIL;
  else process.env.SMS_PROFIL = vorherProfil;

  await prisma.$disconnect();
  finish("BETRIEBSFAEHIGKEIT");
}

main().catch((e) => {
  console.error("Abgebrochen:", e?.message ?? e);
  process.exit(1);
});
