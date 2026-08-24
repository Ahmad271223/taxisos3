// QA: Im Echtbetrieb darf NIEMALS ein Erfolg erfunden werden.
//
// Hintergrund: Ohne Stripe-Verbindung lief bisher ein Ersatzmodus, der
// `ok: true` und eine erfundene Vorgangsnummer zurückgab. Der Aufrufer schrieb
// daraufhin "BEZAHLT" in die Datenbank — obwohl nie Geld geflossen ist. Das ist
// im Testbetrieb praktisch, im Echtbetrieb der teuerste denkbare Fehler.
//
// Ebenfalls geprüft: eine fehlende Vorgangsnummer galt früher als "Ersatzmodus"
// und meldete deshalb selbst bei echter Stripe-Verbindung Erfolg.
//
// Aufruf: node scripts/qa/no_fake_success.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const H = require("./helpers");
const { check, info, section, finish } = H;

const ROOT = path.resolve(__dirname, "../..");
const PROBE = path.join(ROOT, "scripts", "qa", "_stripe_probe.ts");

// Ruft die Geldfunktionen OHNE Stripe-Schlüssel auf und meldet die Ergebnisse.
fs.writeFileSync(PROBE, `import {
  chargeSavedCard, capturePayment, voidPayment, refundPayment, holdOnSavedCard,
  authorizePayment, createAuthIntent, createStripeCustomer, createConnectAccount,
  createAccountLink, getConnectStatus, detachCard,
} from "../../src/lib/stripe";

(async () => {
  const r: Record<string, any> = {};
  r.charge = await chargeSavedCard({ stripeCustomerId: "cus_x", paymentMethodId: "pm_x", amountEur: 10 });
  r.hold = await holdOnSavedCard({ stripeCustomerId: "cus_x", paymentMethodId: "pm_x", amountEur: 10 });
  r.capture = await capturePayment("pi_x", 10);
  r.void = await voidPayment("pi_x");
  r.refund = await refundPayment("pi_x", 10);
  r.authorize = await authorizePayment(10);
  r.intent = await createAuthIntent(10);
  r.customer = await createStripeCustomer("a@b.de", "A");
  r.connect = await createConnectAccount("a@b.de", "Firma");
  r.link = await createAccountLink("acct_x", "https://x.de", "https://x.de");
  r.status = await getConnectStatus("mock_acct_123");
  r.detach = await detachCard("pm_x");
  // Fehlende Vorgangsnummer darf NIE als Erfolg gelten.
  r.captureOhneRef = await capturePayment(null, 10);
  console.log("ERGEBNIS:" + JSON.stringify(r));
})();
`, "utf8");

function probe(env) {
  const res = spawnSync("npx", ["tsx", "scripts/qa/_stripe_probe.ts"], {
    cwd: ROOT,
    env: { ...process.env, STRIPE_SECRET_KEY: "", ...env },
    encoding: "utf8", timeout: 120_000, shell: true,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const line = out.split("\n").find((l) => l.startsWith("ERGEBNIS:"));
  if (!line) throw new Error("Keine Antwort der Prüffunktion:\n" + out.slice(0, 800));
  return JSON.parse(line.slice("ERGEBNIS:".length));
}

function main() {
  section("1) ECHTBETRIEB ohne Zahlungsanbindung: kein erfundener Erfolg");
  const live = probe({ NODE_ENV: "production" });
  check("Kartenbelastung meldet ehrlich einen Fehler", live.charge.ok === false, live.charge);
  check("Deckungsprüfung meldet ehrlich einen Fehler", live.hold.ok === false, live.hold);
  check("Einzug meldet ehrlich einen Fehler", live.capture.ok === false, live.capture);
  check("Freigabe meldet ehrlich einen Fehler", live.void.ok === false, live.void);
  check("Rückerstattung meldet ehrlich einen Fehler", live.refund.ok === false, live.refund);
  check("Autorisierung meldet ehrlich einen Fehler", live.authorize.ok === false, live.authorize);
  check("Zahlungsvorgang meldet ehrlich einen Fehler", live.intent.ok === false, live.intent);
  info(`Meldung an den Kunden: ${live.charge.error}`);

  section("2) Keine erfundenen Kennungen in der Datenbank");
  check("Kein Ersatz-Zahlungskonto", live.customer.ok === false, live.customer);
  check("Kein Ersatz-Firmenkonto", live.connect.ok === false, live.connect);
  check("Keine Ersatz-Anmeldestrecke", live.link.ok === false, live.link);
  // `status` gespiegelt den übergebenen Eingabewert zurück – der zählt nicht
  // als erzeugte Kennung. Geprüft wird alles, was neu entstanden ist.
  const erzeugt = JSON.stringify({ ...live, status: undefined });
  check("Nirgends eine mock_-Kennung erzeugt", !/mock_(pi|cus|acct|auth|seti|hold|re)_/.test(erzeugt),
    (erzeugt.match(/mock_[a-z]+_[a-z0-9]+/g) ?? []).slice(0, 5));

  section("3) Ersatz-Firmenkonto gilt nicht als auszahlungsbereit");
  check("Auszahlungen NICHT als aktiv gemeldet", live.status.chargesEnabled === false, live.status);
  check("Angaben NICHT als vollständig gemeldet", live.status.detailsSubmitted === false, live.status);
  info("Sonst würden Fahrpreise an ein erfundenes Konto überwiesen.");

  section("4) Kartenlöschung wird nicht vorgetäuscht");
  check("Löschung meldet Misserfolg statt Erfolg", live.detach === false, live.detach);
  info("Sonst hieße es 'Karte entfernt', während sie bei Stripe hängen bleibt.");

  section("5) Fehlende Vorgangsnummer ist ein Fehler, kein Ersatzmodus");
  check("Einzug ohne Vorgangsnummer schlägt fehl", live.captureOhneRef.ok === false, live.captureOhneRef);

  section("6) Testbetrieb bleibt uneingeschränkt nutzbar");
  const dev = probe({ NODE_ENV: "development" });
  check("Kartenbelastung läuft im Ersatzmodus", dev.charge.ok === true && dev.charge.mock === true, dev.charge);
  check("Deckungsprüfung läuft im Ersatzmodus", dev.hold.ok === true && dev.hold.mock === true, dev.hold);
  check("Zahlungskonto wird angelegt", dev.customer.ok === true, dev.customer);
  check("Als Ersatz gekennzeichnet", dev.charge.mock === true && dev.customer.mock === true);
  check("Fehlende Vorgangsnummer schlägt auch hier fehl", dev.captureOhneRef.ok === false, dev.captureOhneRef);

  fs.unlinkSync(PROBE);
  finish("KEIN-ERFUNDENER-ERFOLG");
}

main();
