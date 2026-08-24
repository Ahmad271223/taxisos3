// Startsperre fuer den Echtbetrieb.
//
// Der teuerste denkbare Fehler ist, mit Testeinstellungen live zu gehen:
// Fahrten werden dann nie wirklich bezahlt, virtuelle Fahrer nehmen echte
// Auftraege an, SMS gehen nirgendwohin. Deshalb prueft der Server beim Start
// selbst, ob er im Produktionsmodus laufen DARF.
//
//   NODE_ENV=production  -> harte Fehler beenden den Start
//   sonst                -> nur Hinweise auf der Konsole
//
// Notausgang fuer eine bewusste Generalprobe mit Testdaten:
//   ALLOW_TEST_MODE_IN_PRODUCTION=1

export interface GuardFinding {
  fatal: boolean;
  key: string;
  problem: string;
  fix: string;
  /** Auch die Generalprobe darf hierueber nicht hinweggehen (Sicherheitsluecke). */
  unumgehbar?: boolean;
}

export function collectFindings(env = process.env): GuardFinding[] {
  const f: GuardFinding[] = [];
  const has = (v?: string) => !!(v && v.trim());

  // --- Geld -----------------------------------------------------------------
  const sk = env.STRIPE_SECRET_KEY ?? "";
  if (!has(sk)) {
    f.push({
      fatal: true, key: "STRIPE_SECRET_KEY",
      problem: "Kein Stripe-Schlüssel – Kartenzahlung funktioniert nicht.",
      fix: "Live-Schlüssel (sk_live_…) aus dem Stripe-Dashboard eintragen.",
    });
  } else if (!sk.startsWith("sk_live") && !sk.startsWith("rk_live")) {
    f.push({
      fatal: true, key: "STRIPE_SECRET_KEY",
      problem: "Stripe läuft im TESTMODUS – es fließt kein echtes Geld.",
      fix: "Test-Schlüssel gegen den Live-Schlüssel (sk_live_…) tauschen.",
    });
  }
  if (!has(env.STRIPE_WEBHOOK_SECRET)) {
    f.push({
      fatal: false, key: "STRIPE_WEBHOOK_SECRET",
      problem: "Keine Stripe-Webhooks – Abo- und Auszahlungsstatus kommen verzögert.",
      fix: "Im Stripe-Dashboard einen Webhook auf /api/stripe/webhook anlegen und das Signaturgeheimnis eintragen.",
    });
  }

  // --- Betrieb --------------------------------------------------------------
  if (env.ENABLE_SIMULATOR === "1") {
    f.push({
      fatal: true, key: "ENABLE_SIMULATOR",
      problem: "Der Fahrten-Simulator ist an – erfundene Fahrer nehmen echte Aufträge an.",
      fix: "ENABLE_SIMULATOR=0 setzen.",
    });
  }
  if (env.SMS_DISABLED === "1") {
    f.push({
      fatal: true, key: "SMS_DISABLED",
      problem: "Der SMS-Notaus ist aktiv – Kunden bekommen keine Benachrichtigungen.",
      fix: "SMS_DISABLED entfernen oder auf 0 setzen.",
    });
  }
  if (env.REQUIRE_PHONE_VERIFICATION === "0") {
    f.push({
      fatal: false, key: "REQUIRE_PHONE_VERIFICATION",
      problem: "Telefonnummern werden nicht geprüft – Fehl- und Scherzbuchungen sind möglich.",
      fix: "REQUIRE_PHONE_VERIFICATION=1 setzen.",
    });
  }
  const geheim = env.AUTH_SECRET ?? "";
  if (geheim.length < 32 || geheim === "dev-secret-bitte-aendern" || geheim === "bitte-aendern") {
    f.push({
      // Keine Testeinstellung, sondern eine offene Tür: mit bekanntem oder
      // schwachem Schlüssel kann sich jeder als beliebiger Nutzer ausgeben.
      // Deshalb auch von der Generalprobe NICHT umgehbar.
      fatal: true, unumgehbar: true, key: "AUTH_SECRET",
      problem: "Der Sitzungsschlüssel ist zu kurz oder der bekannte Standardwert – Anmeldungen wären fälschbar.",
      fix: "Mindestens 32 Zeichen Zufall setzen (openssl rand -hex 32).",
    });
  }
  const base = env.APP_BASE_URL ?? "";
  if (!has(base) || base.includes("localhost") || base.startsWith("http://")) {
    f.push({
      fatal: true, key: "APP_BASE_URL",
      problem: "Keine öffentliche HTTPS-Adresse – Stripe-Rücksprünge und Links führen ins Leere.",
      fix: "APP_BASE_URL auf die echte Domain setzen, z. B. https://ihre-domain.de",
    });
  }
  if (!has(env.ALLOWED_ORIGINS)) {
    f.push({
      fatal: false, key: "ALLOWED_ORIGINS",
      problem: "Die Live-Verbindung nimmt Anfragen von jeder Website an.",
      fix: "ALLOWED_ORIGINS auf die eigene Domain setzen.",
    });
  }

  // --- SMS ------------------------------------------------------------------
  if (!has(env.TWILIO_ACCOUNT_SID)) {
    f.push({
      fatal: true, key: "TWILIO_ACCOUNT_SID",
      problem: "Kein SMS-Versand eingerichtet.",
      fix: "Twilio-Zugangsdaten eintragen.",
    });
  }
  const from = env.TWILIO_FROM ?? "";
  if (has(from) && !from.startsWith("+49") && !/^[A-Za-z]/.test(from)) {
    f.push({
      fatal: false, key: "TWILIO_FROM",
      problem: `Absender ${from} ist keine deutsche Nummer – SMS landen häufiger im Spam oder werden blockiert.`,
      fix: "Deutsche Twilio-Nummer (+49…) oder registrierte Alphanumerik als Absender verwenden.",
    });
  }

  // --- Fremddienste ---------------------------------------------------------
  if (!has(env.MAPBOX_TOKEN) && !has(env.LOCATIONIQ_KEY) && !has(env.GOOGLE_MAPS_KEY)) {
    f.push({
      fatal: false, key: "MAPBOX_TOKEN",
      problem: "Adresssuche und Routen laufen über die kostenlosen OSM-Dienste. Deren Nutzungsbedingungen erlauben KEINE gewerbliche Nutzung, und sie drosseln bei Last.",
      fix: "Kostenpflichtigen Anbieter buchen (Mapbox, LocationIQ oder Google) und den Schlüssel eintragen.",
    });
  }
  if (!has(env.AVIATIONSTACK_KEY)) {
    f.push({
      fatal: false, key: "AVIATIONSTACK_KEY",
      problem: "Flugnummern liefern Demo-Daten statt echter Ankunftszeiten.",
      fix: "Flugdaten-Zugang buchen und Schlüssel eintragen.",
    });
  }
  if (!has(env.VAPID_PUBLIC_KEY) || !has(env.VAPID_PRIVATE_KEY)) {
    f.push({
      fatal: false, key: "VAPID_PUBLIC_KEY",
      problem: "Keine Push-Nachrichten – Fahrer verpassen Aufträge bei gesperrtem Bildschirm.",
      fix: "Schlüsselpaar erzeugen: npx web-push generate-vapid-keys",
    });
  }

  return f;
}

/** Beim Start aufrufen. Beendet den Prozess, wenn der Echtbetrieb unsicher wäre. */
export function assertLiveReady(env = process.env): void {
  const production = env.NODE_ENV === "production";
  const findings = collectFindings(env);
  if (findings.length === 0) {
    if (production) console.log("Live-Prüfung: alle Einstellungen in Ordnung.");
    return;
  }

  const fatal = findings.filter((x) => x.fatal);
  const warn = findings.filter((x) => !x.fatal);
  const bypass = env.ALLOW_TEST_MODE_IN_PRODUCTION === "1";

  const zeile = (x: GuardFinding, marke: string) =>
    `  ${marke} ${x.key}\n      ${x.problem}\n      -> ${x.fix}`;

  if (!production) {
    if (fatal.length) {
      console.log(`\nHinweis: ${fatal.length} Einstellung(en) verhindern später den Echtbetrieb (im Testbetrieb unkritisch):`);
      for (const x of fatal) console.log(`  - ${x.key}: ${x.problem}`);
    }
    return;
  }

  if (warn.length) {
    console.warn("\nLive-Prüfung – Einschränkungen:");
    for (const x of warn) console.warn(zeile(x, "!"));
  }
  if (!fatal.length) return;

  console.error("\nLive-Prüfung FEHLGESCHLAGEN – der Start wird abgebrochen:");
  for (const x of fatal) console.error(zeile(x, "X"));

  const hart = fatal.filter((x) => x.unumgehbar);
  if (bypass && hart.length === 0) {
    console.warn(
      "\nALLOW_TEST_MODE_IN_PRODUCTION=1 ist gesetzt – der Start läuft trotzdem weiter.\n" +
        "Nur für eine Generalprobe verwenden, NIEMALS mit echten Kunden.\n",
    );
    return;
  }
  if (bypass && hart.length > 0) {
    console.error(
      "\nALLOW_TEST_MODE_IN_PRODUCTION hilft hier nicht: " +
        hart.map((x) => x.key).join(", ") +
        " ist eine Sicherheitslücke, keine Testeinstellung.\n",
    );
  }
  console.error(
    "\nBehebung: die oben genannten Werte in der .env korrigieren.\n" +
      "Bewusste Generalprobe mit Testdaten: ALLOW_TEST_MODE_IN_PRODUCTION=1 setzen.\n",
  );
  process.exit(1);
}
