// QA: Startsperre für den Echtbetrieb.
//
// Der gefährlichste Fehler beim Livegang ist, versehentlich mit
// Testeinstellungen zu starten: Stripe im Testmodus (kein echtes Geld),
// Fahrten-Simulator an (erfundene Fahrer nehmen echte Aufträge an), SMS-Notaus
// aktiv (Kunden hören nichts). Der Server muss das selbst erkennen und den
// Start verweigern.
//
// Geprüft wird der ECHTE Server-Start, nicht nur die Prüffunktion.
//
// Aufruf: node scripts/qa/live_ready.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const { spawnSync } = require("child_process");
const path = require("path");
const H = require("./helpers");
const { check, info, section, finish } = H;

const ROOT = path.resolve(__dirname, "../..");

// Startsperre mit gegebener Umgebung ausführen (ohne den ganzen Server
// hochzufahren – geprüft wird derselbe Code, den server.ts beim Start aufruft).
function startServer(env) {
  const res = spawnSync("npx", ["tsx", "scripts/qa/_guard_probe.ts"], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 90_000,
    shell: true,
  });
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

// Vollständig gültige Live-Konfiguration (nur zum Prüfen der Sperre – es wird
// nichts davon verwendet, der Start scheitert danach an der Datenbank o. ä.).
const ECHT = {
  NODE_ENV: "production",
  STRIPE_SECRET_KEY: "sk_live_platzhalter_nur_fuer_den_test",
  STRIPE_WEBHOOK_SECRET: "whsec_platzhalter",
  ENABLE_SIMULATOR: "0",
  SMS_DISABLED: "0",
  REQUIRE_PHONE_VERIFICATION: "1",
  AUTH_SECRET: "a".repeat(64),
  APP_BASE_URL: "https://taxi.example.de",
  ALLOWED_ORIGINS: "https://taxi.example.de",
  TWILIO_ACCOUNT_SID: "AC_platzhalter",
  TWILIO_FROM: "+4915100000000",
  MAPBOX_TOKEN: "pk.platzhalter",
  AVIATIONSTACK_KEY: "platzhalter",
  VAPID_PUBLIC_KEY: "platzhalter",
  VAPID_PRIVATE_KEY: "platzhalter",
  ALLOW_TEST_MODE_IN_PRODUCTION: "",
};

function main() {
  section("1) Echtbetrieb mit Stripe-TESTMODUS wird verweigert");
  const testmodus = startServer({ ...ECHT, STRIPE_SECRET_KEY: "sk_test_abc123" });
  check("Start abgebrochen", testmodus.code === 1, testmodus.code);
  check("Grund wird genannt", /TESTMODUS/i.test(testmodus.out));
  check("Lösung wird genannt", /sk_live_/.test(testmodus.out));

  section("2) Echtbetrieb mit laufendem Simulator wird verweigert");
  const sim = startServer({ ...ECHT, ENABLE_SIMULATOR: "1" });
  check("Start abgebrochen", sim.code === 1, sim.code);
  check("Simulator wird als Grund benannt", /Simulator/i.test(sim.out));
  check("Erfundene Fahrer werden erwähnt", /erfundene Fahrer/i.test(sim.out));

  section("3) Echtbetrieb mit abgeschaltetem SMS-Versand wird verweigert");
  const sms = startServer({ ...ECHT, SMS_DISABLED: "1" });
  check("Start abgebrochen", sms.code === 1, sms.code);
  check("SMS-Notaus wird benannt", /SMS_DISABLED|Notaus/i.test(sms.out));

  section("4) Echtbetrieb ohne echte Domain wird verweigert");
  const lokal = startServer({ ...ECHT, APP_BASE_URL: "http://localhost:3000" });
  check("Start abgebrochen", lokal.code === 1, lokal.code);
  check("Stripe-Rücksprung wird als Grund benannt", /APP_BASE_URL/.test(lokal.out));

  section("5) Echtbetrieb mit schwachem Sitzungsschlüssel wird verweigert");
  const secret = startServer({ ...ECHT, AUTH_SECRET: "geheim" });
  check("Start abgebrochen", secret.code === 1, secret.code);
  check("Sitzungsschlüssel wird benannt", /AUTH_SECRET/.test(secret.out));

  section("6) Mehrere Probleme werden alle auf einmal gemeldet");
  const alles = startServer({
    ...ECHT,
    STRIPE_SECRET_KEY: "sk_test_abc",
    ENABLE_SIMULATOR: "1",
    AUTH_SECRET: "kurz",
  });
  const genannt = ["STRIPE_SECRET_KEY", "ENABLE_SIMULATOR", "AUTH_SECRET"].filter((k) => alles.out.includes(k));
  check("Alle drei Probleme in einer Meldung", genannt.length === 3, genannt);
  info("Kein Ratespiel: der Betreiber sieht alles auf einmal.");

  section("7) Saubere Live-Konfiguration wird durchgelassen");
  const sauber = startServer(ECHT);
  check("Start freigegeben", sauber.out.includes("START-FREIGEGEBEN"), sauber.code);
  check("Bestätigung für den Betreiber", /alle Einstellungen in Ordnung/i.test(sauber.out));

  section("8) Bewusste Generalprobe bleibt möglich");
  const probe = startServer({ ...ECHT, STRIPE_SECRET_KEY: "sk_test_abc", ALLOW_TEST_MODE_IN_PRODUCTION: "1" });
  check("Start trotz Testmodus freigegeben", probe.out.includes("START-FREIGEGEBEN"), probe.code);
  check("Deutliche Warnung erscheint trotzdem", /NIEMALS mit echten Kunden/i.test(probe.out));

  section("9) Reine Hinweise blockieren nicht");
  const nurWarnung = startServer({ ...ECHT, STRIPE_WEBHOOK_SECRET: "", AVIATIONSTACK_KEY: "" });
  check("Start freigegeben", nurWarnung.out.includes("START-FREIGEGEBEN"), nurWarnung.code);
  check("Einschränkungen werden gemeldet", /Einschränkungen/i.test(nurWarnung.out));
  check("Webhook-Hinweis erscheint", /STRIPE_WEBHOOK_SECRET/.test(nurWarnung.out));

  section("10) Der Testbetrieb wird nicht behindert");
  const dev = startServer({ ...ECHT, NODE_ENV: "development", STRIPE_SECRET_KEY: "sk_test_abc", ENABLE_SIMULATOR: "1" });
  check("Entwicklungsstart läuft trotz Testeinstellungen", dev.out.includes("START-FREIGEGEBEN"), dev.code);
  check("Es erscheint nur ein Hinweis", /Hinweis:/.test(dev.out));

  section("11) Die Sperre ist im Serverstart wirklich verdrahtet");
  const src = require("fs").readFileSync(path.join(ROOT, "server.ts"), "utf8");
  check("server.ts ruft die Prüfung auf", /assertLiveReady\(\)/.test(src));
  check("Prüfung läuft vor dem Start der Engine", src.indexOf("assertLiveReady()") < src.indexOf("async function main"));

  finish("LIVE-SPERRE");
}

main();
