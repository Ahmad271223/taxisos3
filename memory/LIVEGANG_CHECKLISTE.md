# Livegang — was noch zu tun ist

Stand: 25.08.2026. Alles hier Aufgeführte braucht **ein Konto, eine
Unterschrift oder Geld** — es lässt sich nicht programmieren.

Der Softwarestand dazu: `memory/PRD.md`. Was im Störungsfall zu tun ist:
`memory/BETRIEBSHANDBUCH.md`.

---

## A. Ohne das startet der Server nicht

Die Startsperre (`src/server/liveGuard.ts`) bricht bei `NODE_ENV=production`
ab. Das ist Absicht — jeder Punkt hat einen konkreten Schaden dahinter.

- [ ] **Stripe freischalten** und `STRIPE_SECRET_KEY` als Live-Schlüssel
      eintragen. Das Konto ist DE/EUR, aber Zahlungen und Auszahlungen sind
      noch nicht aktiviert.
- [ ] **Twilio auf ein bezahltes Konto** umstellen (`TWILIO_ACCOUNT_SID`).
      Aktuell Trial: SMS nur an verifizierte Nummern, mit Testhinweis im Text,
      rund 50 am Tag.
- [ ] **`AUTH_SECRET`** mit mindestens 32 zufälligen Zeichen setzen. Nicht der
      Standardwert — diese Sperre ist **nicht umgehbar**, weil sich mit einem
      erratbaren Geheimnis beliebige Sitzungen fälschen ließen.
- [ ] **Domain mit HTTPS** in `APP_BASE_URL` und `ALLOWED_ORIGINS`.
- [ ] **`SMS_DISABLED` und `ENABLE_SIMULATOR` ausschalten**, sonst läuft der
      Echtbetrieb mit Testfahrern.

## B. Ohne das solltest du nicht starten

- [ ] **Kartendienst lizenzieren** (Mapbox oder LocationIQ). Die kostenlosen
      OSM-Dienste erlauben **keine gewerbliche Nutzung** und drosseln — im
      Test ist die Routenberechnung deshalb schon zeitweise ausgefallen. Das
      ist ein Lizenz-, kein Technikproblem.
- [ ] **Bezahlter Hosting-Plan** (Render). Der kostenlose Plan hat **keine**
      Wiederherstellungspunkte — es gibt dort schlicht keine Sicherung.
- [ ] **Wiederherstellung einmal proben.** Ablauf in
      `BETRIEBSHANDBUCH.md`, Abschnitt 7. Die dabei gemessene Dauer ist deine
      Antwort auf „wie lange sind wir im Ernstfall offline".
- [ ] **Alarmierung einrichten** — mindestens `ALARM_WEBHOOK_URL` (Slack,
      Discord, n8n) oder `ALARM_EMAIL`. Die Technik ist eingebaut, aber
      solange kein Weg gesetzt ist, landen Alarme nur im Protokoll. Der Server
      sagt beim Start ausdrücklich, wenn das der Fall ist.
- [ ] **AV-Verträge abschließen** — Stripe, Twilio, Resend, Render,
      Kartendienst. Liste mit Fundstellen: `memory/DSGVO/Auftragsverarbeiter.md`.
      Bei Render **Region Frankfurt** wählen, nicht die Voreinstellung Oregon.
- [ ] **DSGVO-Entwürfe prüfen lassen.** Verarbeitungsverzeichnis,
      Löschkonzept und TOM liegen unter `memory/DSGVO/` — als Entwurf, nicht
      als Rechtsberatung. Besonders zu klären: die Rechtsgrundlage für
      Krankenfahrten (Art. 9) und die Rollenverteilung mit den Taxiunternehmen
      (Art. 26).
- [ ] **Probelauf mit einem echten Fahrer** auf einem echten Handy mit echtem
      GPS. Bisher war nie ein realer Fahrer im System.

## C. Empfohlen, aber nicht blockierend

- [ ] `STRIPE_WEBHOOK_SECRET` setzen und den Webhook auf
      `/api/stripe/webhook` einrichten.
- [ ] `REQUIRE_PHONE_VERIFICATION=1` einschalten.
- [ ] `TWILIO_FROM` auf eine **deutsche** Absendernummer setzen.
- [ ] `AVIATIONSTACK_KEY` für echte Flugdaten (sonst Demo-Verspätungen).
- [ ] Auf Render **Health Check Path** auf `/api/health` setzen.
- [ ] `TRUSTED_PROXY_HOPS=1` (Render). Ohne das erkennt die Drosselung keine
      Client-IPs; der Server warnt dann im Protokoll.
- [ ] `npm i @sentry/node` und `SENTRY_DSN` setzen, falls Sentry gewünscht ist.

---

## D. Die Entscheidung, die niemand außer dir treffen kann

**Die SMS-Kosten übersteigen im kleinsten Tarif die Einnahmen.**

Eine Sofortfahrt löst rund 3 SMS aus (≈ 0,25 €), eine Vorbestellung rund 6
(≈ 0,49 €). Bei 1.200 Fahrten im Monat sind das etwa **292 € Twilio-Kosten
gegen 100 € Abo-Einnahme** im Tarif P5. Eine aktive kleine Firma kostet dich
damit Geld.

Der Kostentreiber sind die **drei** Erinnerungen je Vorbestellung (24 h, 2 h,
30 min). Dafür gibt es jetzt `SMS_PROFIL`:

| Profil | Erinnerungen | Vorbestellung |
|---|---|---|
| `voll` | 24 h, 2 h, 30 min | ~6 SMS |
| `sparsam` **(neuer Standard)** | nur 2 h | ~4 SMS |
| `minimal` | keine | ~3 SMS |

Damit sinken 1.200 Fahrten von rund 292 € auf grob 200 € (`sparsam`)
beziehungsweise 160 € (`minimal`). **Das reicht im Tarif P5 immer noch nicht.**
Drei Wege:

1. **Tarife anheben.** P5 von 100 € auf etwa 150 € — dann trägt sich auch eine
   Firma mit vielen Vorbestellungen.
2. **SMS-Kontingent je Tarif** und Weiterberechnung darüber hinaus. Fair, aber
   du brauchst dafür eine Abrechnung pro Firma; die gibt es noch nicht.
3. **Push statt SMS** für Fahrgäste mit Konto. Die Schlüssel sind erzeugt, der
   Weg ist eingebaut — er ist nur auf echten Geräten noch nicht erprobt. SMS
   bliebe dann für Gäste ohne Konto.

Empfehlung: **`sparsam` behalten, P5 auf 150 € anheben und Punkt 3 als
nächstes ausbauen.** Punkt 2 ist der sauberste, aber der teuerste in der
Umsetzung.

---

## E. Was danach kommen sollte

Keine dieser Baustellen hindert dich am Start, aber jede wird mit der Zeit
teurer:

- **Kaskadenlöschung entschärfen.** Heute löscht das Entfernen eines
  Unternehmens auch dessen abgerechnete Fahrten. Bis das auf Soft-Delete
  umgestellt ist: Unternehmen und Fahrer **deaktivieren**, nicht löschen.
- **Fahrgäste können Name, E-Mail und Telefon nicht selbst ändern.** Das Recht
  auf Berichtigung ist derzeit nur manuell erfüllbar.
- **Kein Prüfpfad für Preisänderungen** — wer wann welchen Tarif geändert hat,
  lässt sich nicht nachvollziehen.
- **Zweite Instanz ab ~60 gleichzeitig fahrenden Fahrern**, dann mit
  Redis-Adapter für Socket.IO und gemeinsamem Drosselungsspeicher.
- **Kein Datenexport für Betroffene** (Art. 15/20 nur manuell).
