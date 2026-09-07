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
- [ ] **Stripe Connect aktivieren** (Stripe → Connect → Einstellungen, Typ
      *Express*, Land Deutschland). Ohne Connect kann kein Taxiunternehmen ein
      eigenes Auszahlungskonto hinterlegen; alle Kartenzahlungen liefen dann
      über das Plattform-Konto und müssten von Hand weitergereicht werden.
      Jede Firma richtet ihr Konto danach selbst ein unter
      **Dashboard → Auszahlung** (`/admin/auszahlung`).
- [x] **Twilio auf ein bezahltes Konto** umgestellt (07.09.2026). Konto steht
      auf *Full* und ist aktiv. Damit: SMS an **jede** Nummer, kein
      Testhinweis mehr im Text, kein Tageslimit.
- [x] **Absender `TWILIO_FROM=Altstadttax`** (alphanumerisch, geprüft:
      zugestellt in unter 4 Sekunden). Hintergrund:
      - Die mitgelieferte US-Nummer (+1 517…) taugt für Deutschland nicht —
        deutsche Netze filtern SMS von US-Rufnummern häufig weg.
      - Alphanumerische Absender brauchen in Deutschland keine Voranmeldung,
        sind aber auf **11 Zeichen** begrenzt. `altstadttaxi` hat 12 und wird
        von Twilio abgelehnt (Fehler 21212), deshalb `Altstadttax`.
        Saubere Alternative, falls die Abkürzung stört: `Altstadt`.
      - Der Empfänger kann auf einen alphanumerischen Absender nicht antworten.
        Für Bestätigungen und Codes ohne Belang; wer Rückantworten braucht,
        müsste eine deutsche Rufnummer kaufen (Nachweis der Anschrift nötig).
- [ ] **Twilio-Werte bei Render eintragen** — dort fehlen sie noch komplett:
      `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM=Altstadttax`.
      Solange sie fehlen, verschickt die Live-App **keine** SMS.
- [ ] **US-Nummer freigeben**, falls nicht gebraucht (Twilio → Phone Numbers).
      Sie kostet rund 1 $ im Monat und wird als Absender nicht mehr verwendet.
- [ ] **`AUTH_SECRET`** mit mindestens 32 zufälligen Zeichen setzen. Nicht der
      Standardwert — diese Sperre ist **nicht umgehbar**, weil sich mit einem
      erratbaren Geheimnis beliebige Sitzungen fälschen ließen.
- [ ] **Domain mit HTTPS** in `APP_BASE_URL` und `ALLOWED_ORIGINS` — die Domain
      steht fest: **altstadttaxi-hannover.de** (Anleitung unten in Abschnitt F).
- [ ] **`SMS_DISABLED` und `ENABLE_SIMULATOR` ausschalten**, sonst läuft der
      Echtbetrieb mit Testfahrern.
- [ ] **Google Maps — zwei Schlüssel** aus der Google Cloud Console (Abrechnungskonto
      ist Pflicht, 200 $ Freikontingent/Monat):
      `GOOGLE_MAPS_API_KEY` (Server: Geocoding API + Routes API, auf diese zwei
      APIs eingeschränkt) und `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Browser: Maps
      JavaScript API, auf `taxisos3.onrender.com` und die eigene Domain
      eingeschränkt). Der Browser-Schlüssel wird beim Build eingebacken —
      nach jeder Änderung neu deployen. Seit dem 07.09.2026 gibt es keine
      andere Karte mehr: ohne diese Schlüssel verweigert die Startsperre den
      Echtbetrieb.

## B. Ohne das solltest du nicht starten

- ~~Kartendienst lizenzieren~~ → erledigt durch Google Maps (siehe Abschnitt A).
- [ ] **Bezahlter Hosting-Plan** (Render). Der kostenlose Plan hat **keine**
      Wiederherstellungspunkte — es gibt dort schlicht keine Sicherung.
- [ ] **Datenbank abschotten:** Render → Datenbank `taxisos-db` → *Access Control*.
      Dort steht standardmäßig `0.0.0.0/0` (aus dem ganzen Internet erreichbar).
      Diesen Eintrag **entfernen** — die App spricht über die interne Adresse
      (die `DATABASE_URL` aus dem Blueprint ist bereits die interne). Nur wenn du
      selbst per Tool auf die Datenbank willst, deine eigene IP eintragen.
- [ ] **Wiederherstellung einmal proben.** Ablauf in
      `BETRIEBSHANDBUCH.md`, Abschnitt 7. Die dabei gemessene Dauer ist deine
      Antwort auf „wie lange sind wir im Ernstfall offline".
- [ ] **Alarmierung einrichten** — mindestens `ALARM_WEBHOOK_URL` (Slack,
      Discord, n8n) oder `ALARM_EMAIL`. Die Technik ist eingebaut, aber
      solange kein Weg gesetzt ist, landen Alarme nur im Protokoll. Der Server
      sagt beim Start ausdrücklich, wenn das der Fall ist.
- [ ] **AV-Verträge abschließen** — Stripe, Twilio, Resend, Render,
      Google. Liste mit Fundstellen: `memory/DSGVO/Auftragsverarbeiter.md`.
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

- ~~Kaskadenlöschung entschärfen.~~ **Geprüft am 26.08.2026: kein Problem.**
  Fahrten hängen mit `SetNull` an Firma und Fahrer und bleiben beim Löschen
  erhalten; im Produkt gibt es ohnehin keine Funktion, eine Firma zu löschen.
  Die frühere Warnung an dieser Stelle war falsch.
- ~~Fahrgäste können Stammdaten nicht selbst ändern.~~ **Erledigt am
  26.08.2026:** im Konto unter „Meine Daten" — Name frei, E-Mail und
  Rufnummer nur mit Passwort, neue Nummer mit SMS-Bestätigung.
- **Kein Prüfpfad für Preisänderungen** — wer wann welchen Tarif geändert hat,
  lässt sich nicht nachvollziehen.
- **Zweite Instanz ab ~60 gleichzeitig fahrenden Fahrern**, dann mit
  Redis-Adapter für Socket.IO und gemeinsamem Drosselungsspeicher.
- **Kein Datenexport für Betroffene** (Art. 15/20 nur manuell).

---

## F. Domain anbinden: altstadttaxi-hannover.de

1. Render → Web-Dienst `taxisos3` → **Settings → Custom Domains → Add**:
   `altstadttaxi-hannover.de` **und** `www.altstadttaxi-hannover.de`.
   Render zeigt je Domain den nötigen DNS-Eintrag an.
2. Beim Domain-Anbieter (wo die Domain registriert ist) im DNS setzen:
   - `altstadttaxi-hannover.de` → **A-Record** auf die von Render angezeigte IP
   - `www` → **CNAME** auf `taxisos3.onrender.com`
   DNS braucht 5 Minuten bis einige Stunden. Render stellt das TLS-Zertifikat
   danach automatisch aus (Status in *Custom Domains* wird grün).
3. In Render → **Environment** setzen und neu deployen:
   - `APP_BASE_URL` = `https://altstadttaxi-hannover.de`
   - `ALLOWED_ORIGINS` = `https://altstadttaxi-hannover.de,https://www.altstadttaxi-hannover.de`
4. Google Cloud → Browser-Schlüssel → Website-Einschränkungen: beide Domains
   stehen bereits drin (`…/*`). Nach dem Livegang `http://localhost:3000/*`
   und die onrender-Adresse entfernen.
5. Stripe → Entwickler → Webhooks: Endpunkt auf
   `https://altstadttaxi-hannover.de/api/payments/webhook` legen (NICHT
   `/api/stripe/webhook` — diesen Pfad gibt es nicht), Secret als
   `STRIPE_WEBHOOK_SECRET` eintragen. Diese Ereignisse ankreuzen:
   `payment_intent.succeeded`, `payment_intent.payment_failed`,
   `payment_intent.canceled`, `account.updated`,
   `customer.subscription.created/updated/deleted`, `invoice.paid`,
   `invoice.payment_failed`, `checkout.session.completed`.
   `account.updated` ist der wichtigste: darüber erfährt die App, dass ein
   Taxiunternehmen seine Stripe-Prüfung bestanden hat. Fehlt es, gelten alle
   Firmen dauerhaft als nicht auszahlungsbereit und jede Kartenzahlung landet
   auf dem Plattform-Konto.
6. Impressum/Datenschutzerklärung auf der Seite nennen die Domain und die
   Empfänger (Google, Stripe, Twilio, Resend, Render).
