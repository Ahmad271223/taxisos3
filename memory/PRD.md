# TaxiOS – Produktstand

**Stand: 24. August 2026.** Dieses Dokument beschreibt den Ist-Zustand und ist die
Grundlage, auf der weitergebaut wird. Wer etwas ändert, hält es hier nach.

---

## 1. Was TaxiOS ist

Eine Vermittlungsplattform für Taxiunternehmen. Fahrgäste bestellen über die
Website, die Plattform sucht per GPS den nächsten passenden Fahrer, das
Taxiunternehmen verwaltet Fahrer, Preise und Abrechnung im eigenen Dashboard.

**Geschäftsmodell: Monats-Abo, keine Provision pro Fahrt.**
Der Fahrpreis gehört vollständig dem Taxiunternehmen und geht per Stripe Connect
direkt auf dessen Auszahlungskonto. Die Plattform verdient ausschließlich am
Abo der Unternehmen:

| Tarif | Fahrer | € / Monat |
|---|---|---|
| P5 | bis 5 | 100 |
| P10 | bis 10 | 190 |
| P15 | bis 15 | 235 |
| P20 | bis 20 | 260 |

Das Fahrerlimit wird erzwungen (`POST /api/admin/drivers` → HTTP 402
`PLAN_LIMIT_REACHED`). Bei Zahlungsverzug (`UEBERFAELLIG`/`GEKUENDIGT`) lassen
sich keine neuen Fahrer anlegen (402 `SUBSCRIPTION_INACTIVE`); `TRIAL` bleibt erlaubt.

---

## 2. Technischer Aufbau

- **Next.js 14** (App Router) + **Express** + **Socket.IO** in EINEM Prozess
  (`server.ts`, gestartet über `tsx`). Kein separater Proxy.
- **Prisma + PostgreSQL 16**, Migrationen (nicht `db push`).
- **Tailwind**, Markenfarben Gelb `#FFC400` + Ink-Grau.
- **Leaflet** für Karten, **OSRM/Photon/Nominatim** für Routen und Adresssuche
  (kostenlos – für den Echtbetrieb lizenzpflichtig ersetzen, siehe Abschnitt 8).
- **Stripe** für Kartenzahlung, Connect-Auszahlungen und das Abo.
- **Twilio** für SMS.

Start: `npm run dev` → Port 3000.

---

## 3. Oberflächen

**32 Seiten, 111 API-Routen, 41 Komponenten, 7 Dashboards.**

| Dashboard | Pfad | Zweck |
|---|---|---|
| Kundenkonto | `/konto` | Fahrten, Zahlungsmethoden, Notfallkontakt, Punkte |
| Fahrer | `/fahrer` | Aufträge annehmen, Fahrt durchführen, geplante Fahrten |
| Unternehmen | `/admin` | Live-Dispo, Fahrer, Preise, Bewertungen, Zahlungen, Abo |
| Super-Admin | `/super-admin` | Alle Mandanten, Abo-Einnahmen, Support-Tickets |
| Hotel | `/hotel` | Gästefahrten, bevorzugte Flotten, Abrechnung |
| Einrichtung | `/einrichtung` | Patienten, Krankenfahrten, Monatsabrechnung |
| Event | `/event` | Veranstaltungen, Shuttles, Zonen, Aktionscodes |

Buchungswege: Sofortfahrt, Vorbestellung, Flughafen (mit Flugnummer),
Krankenfahrt, Gruppe/Event, Live-Karte mit gezielter Bestellung.

---

## 4. Zahlungsablauf (Kern des Systems)

Der frühere Hold beim Buchen ist **abgeschafft** – er hätte bei Vorbestellungen
tagelang Geld blockiert. Aktuell gilt:

1. **Karte hinterlegen** – im Konto, über Stripes *gehostete* Seite
   (`Checkout mode: "setup"`). Es ist **kein** Publishable Key im Browser nötig.
   Bei uns liegen nur Marke, letzte vier Ziffern und Ablaufdatum
   (`CustomerCard`), nie die Kartennummer.
2. **Buchen** – die Karte wird nur vorgemerkt (`Booking.cardId`).
   **Kein Geld wird angefasst**, auch bei einer Vorbestellung in drei Wochen nicht.
3. **Fahrt geht live** (Fahrer unterwegs) – jetzt erst prüft
   `prepareRidePayment()` die **Deckung**: der geschätzte Preis + 30 % Puffer
   (mind. 15 €) wird bei der Bank reserviert. Schlägt das fehl, steht die Fahrt
   sofort auf `FEHLGESCHLAGEN`, der Kunde bekommt eine SMS und kann noch während
   der Fahrt eine andere Karte wählen; das Unternehmen sieht es im Dashboard.
4. **Fahrtende** – Trinkgeld-Auswahl (Kein/5/10/15/20 %/eigener Betrag).
   Reagiert der Kunde nicht innerhalb von `TIP_WINDOW_MS` (2 Min), rechnet
   `settleDueRides()` automatisch **ohne** Trinkgeld ab.
5. **Einzug** – aus der Reservierung wird **genau der Endpreis** eingezogen, der
   Rest verfällt sofort. Ist der Endbetrag höher als reserviert, wird die
   Reservierung freigegeben und voll belastet.
6. **Storno** – Reservierung wird freigegeben (`voidPayment`).

**Barzahlung** berührt Stripe nie und zeigt **nie** einen Trinkgeld-Dialog.

`paymentStatus`: `OFFEN` (bar) · `KARTE_HINTERLEGT` · `BEZAHLT` ·
`FEHLGESCHLAGEN` (= „Zahlung ausstehend") · `STORNIERT` · `FIRMA`.

**Doppelbuchungs-Sperre:** `Booking.settlingAt` markiert eine laufende
Belastung; ein Eintrag älter als `SETTLE_LOCK_MS` (90 s) gilt als verwaist.
Der Zähler `paymentAttempts` allein reichte nicht – während der ~1 Sekunde
Stripe-Laufzeit kam ein zweiter Lauf durch und belastete erneut.

**Eine gespeicherte Karte funktioniert bei JEDEM Taxiunternehmen**, weil die
Karte am Plattform-Kunden hängt und die Belastung als Destination-Charge
(`transfer_data.destination`, **keine** `application_fee`) läuft.

---

## 5. Vermittlung

- Suche in Stufen: **500 m → 1 → 2 → 3 → 5 km**, je Stufe 15 Sekunden.
- Nach `SEARCH_MAX_MS` (180 s) endet die Suche endgültig (`KEIN_FAHRER`).
  Der Kunde bekommt **genau eine** SMS mit der Nummer der Zentrale
  (`NEXT_PUBLIC_PLATFORM_PHONE`) und kann neu anfragen.
- **30 Minuten vor einer Vorbestellung** wird der Fahrer rückgefragt
  („Fahrt weiterhin durchführen?"). Sagt er ab, sucht die Plattform Ersatz und
  informiert den Fahrgast per SMS.
- **Live-Verfolgung:** ab Annahme sieht der Kunde den Wagen auf der Karte.
  Die **Ankunftszeit** wird laufend neu berechnet (echte Straßenroute,
  gedrosselt auf 20 s / 200 m) und über `booking:eta` gesendet.
- Fahrten aus dem Einrichtungs-Portal gehen standardmäßig an die **Disposition**
  (`dispatchMode: "ADMIN"`), nicht automatisch an Fahrer. Sofortvermittlung nur
  mit `quickOrder: true`.

---

## 6. Sicherheit

- Rollen-Cookies getrennt: `tc_admin`, `tc_driver`, `tc_customer`, `tc_hotel`,
  `tc_event`, `tc_institution`. Alle `httpOnly` + `secure` in Produktion.
- Mandantentrennung geprüft: kein Unternehmen sieht Fahrten, Fahrer oder
  medizinische Dokumente eines anderen.
- `AUTH_SECRET` unter 32 Zeichen oder mit dem bekannten Standardwert lässt den
  Server im Echtbetrieb **nicht starten** – auch nicht über den Notausgang.
- Ohne Stripe-Verbindung wird im Echtbetrieb **kein Erfolg erfunden**: alle
  Geldfunktionen melden einen echten Fehler statt „bezahlt" zu schreiben.
- Der SMS-Bestätigungscode wird nur außerhalb der Produktion **und** nur bei
  lokaler `APP_BASE_URL` zurückgegeben.

**Offen (geringes Risiko):** `GET /api/bookings/<id>` liefert Fahrtdaten auch
ohne Anmeldung, wenn jemand die interne Kennung kennt (nicht durchprobierbar).

---

## 7. Startsperre für den Echtbetrieb

`src/server/liveGuard.ts` läuft als Erstes in `server.ts`. Bei
`NODE_ENV=production` **bricht der Start ab**, wenn:

- der Stripe-Schlüssel ein Testschlüssel ist,
- `ENABLE_SIMULATOR=1` (erfundene Fahrer nehmen echte Aufträge an *und* schließen sie ab),
- `SMS_DISABLED=1`,
- `AUTH_SECRET` schwach ist (**nicht umgehbar**),
- `APP_BASE_URL` fehlt, auf localhost zeigt oder kein HTTPS ist,
- Twilio-Zugangsdaten fehlen.

Warnungen ohne Abbruch: fehlendes Webhook-Geheimnis, `REQUIRE_PHONE_VERIFICATION=0`,
offenes CORS, US-Absendernummer, freie Kartendienste, fehlende Flug-/Push-Schlüssel.

Prüfen ohne Start: `NODE_ENV=production npx tsx scripts/qa/_guard_probe.ts`
Vorlage: `.env.production.example`

---

## 8. Was vor dem Livegang noch fehlt

Alles davon liegt außerhalb der Software – es braucht Konten und Verträge:

1. **Stripe freischalten** und Live-Schlüssel eintragen. Das Konto ist DE/EUR,
   aber noch nicht aktiviert (Zahlungen und Auszahlungen aus).
2. **Twilio auf ein bezahltes Konto** umstellen – aktuell ein Trial: SMS nur an
   verifizierte Nummern, mit Testhinweis im Text, ~50/Tag. Dabei eine **deutsche**
   Absendernummer buchen.
3. **Domain mit HTTPS** in `APP_BASE_URL` und `ALLOWED_ORIGINS`.
4. **Karten- und Routendienst lizenzieren** (Mapbox/LocationIQ/Google). Die
   kostenlosen OSM-Dienste erlauben **keine gewerbliche Nutzung** und drosseln.
5. **Stripe-Webhook** auf `/api/stripe/webhook` einrichten.
6. **Telefon-Verifizierung** einschalten (`REQUIRE_PHONE_VERIFICATION=1`).
7. **Flugdaten-Zugang** (`AVIATIONSTACK_KEY`), sonst Demo-Verspätungen.
8. **Passwörter ändern**: `memory/test_credentials.md` lag im Git-Verlauf.

---

## 9. Kapazität (gemessen)

| Last | Fahrer-Anmeldung | Bestellung | Bewertung |
|---|---|---|---|
| Leerlauf | 60 ms | 67 ms | — |
| 40 Fahrer / 120 Fahrten | 965 ms (max 1,0 s) | 2,1 s | tragfähig |
| 80 Fahrer / 300 Fahrten | 1,5 s (max 20,7 s) | 4,5 s | Grenze |

**Eine Instanz trägt rund 40–60 gleichzeitig arbeitende Fahrer.** Für mehr
braucht es eine zweite Instanz – wegen der Live-Verbindungen mit einem
gemeinsamen Socket-Speicher (Redis-Adapter).

---

## 10. Qualitätssicherung

`scripts/qa/` – Aufruf immer mit `SMS_DISABLED=1`:

```bash
bash scripts/qa/run-all.sh      # alles, mit Serverneustart zwischen den Reihen
node scripts/qa/cleanup.js      # Testdaten entfernen
```

| Reihe | Prüft |
|---|---|
| `frontend_walk` | alle 32 Seiten, Rollentrennung, Mandantentrennung |
| `dashboards` | alle 7 Dashboards mit echten Aktionen |
| `payment_flow` | die 22 Zahlungsfälle |
| `funds_check` | Deckungsprüfung vor der Fahrt |
| `settle_race` | gleichzeitige Zahlungen, Storno während der Kartenprüfung |
| `no_fake_success` | kein erfundener Zahlungserfolg im Echtbetrieb |
| `invoice_retired` | Provisionsrechnung ist stillgelegt |
| `tracking_eta` | Fahrerposition und mitlaufende Ankunftszeit |
| `live_ready` | Startsperre |
| `loadtest` / `loadtest_heavy` | Grundlast und hohe Last |
| `subscription`, `plans_connect` | Abo, Tarifgrenzen, Auszahlungen |
| `driver_confirm_replace` | Rückfrage 30 Min vorher, Ersatzfahrer |
| `chat_offline`, `scheduled_freeze`, `freeze_deadlock`, `flights`, `account_group` | Chat, Vorbestellungen, Flüge, Gruppen |

**Fallstricke beim Testen:**
- Immer `cleanup.js` vor jeder Reihe **und den Server neu starten** – sonst
  greifen Fahrer aus früheren Läufen die Fahrten ab.
- `EADDRINUSE` im Log prüfen: sonst läuft der ALTE Server weiter und die Tests
  prüfen alten Code.
- Der Simulator (`ENABLE_SIMULATOR=1`) nimmt Fahrten automatisch an und
  verfälscht Dispositions-Tests.
- Testfirmen brauchen `plan: "P20"`, sonst greift ab dem 6. Fahrer die
  Tarifgrenze (korrekt, aber im Test verwirrend).

---

## 11. Stillgelegt

Die **Provisions-Sammelrechnung** (Super-Admin und Unternehmensseite) rechnete
nur die Provision pro Fahrt ab. Da diese abgeschafft ist, konnte sie nur noch
Rechnungen über 0,00 € erzeugen – und versenden. Sie ist aus beiden Oberflächen
entfernt, die Endpunkte antworten mit HTTP 410. Der Rechen- und PDF-Code bleibt
erhalten; mit `INVOICE_MODULE=1` lässt sich alles reaktivieren, falls die
Sammelrechnung später auf die Abo-Gebühren umgebaut werden soll.

Die Monatsübersicht unter `/admin/abrechnung` bleibt – sie zeigt dem Unternehmen
jetzt seinen Umsatz **ohne** Provisionsabzug.

---

## 12. Nächste Schritte

- **P1** Kunden können Name, E-Mail und Telefonnummer nicht selbst ändern
  (nur den Notfallkontakt). Für den Echtbetrieb nötig, auch wegen des Rechts
  auf Berichtigung.
- **P1** Push an Fahrer auf echten Geräten erproben (Schlüssel sind erzeugt).
- **P1** Probelauf mit einem echten Fahrer und echtem GPS.
- **P2** `GET /api/bookings/<id>` an eine Anmeldung binden.
- **P2** Preis kennzeichnen, wenn der Routendienst ausgefallen ist
  (Rückfall auf Luftlinie × 1,35 bei 30 km/h ist derzeit unsichtbar).
- **P3** Zweite Instanz + Redis-Adapter, sobald mehr als ~60 Fahrer gleichzeitig fahren.
