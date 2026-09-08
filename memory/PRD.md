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
- **Stille Verbindungsabbrüche:** Ein Socket kann auf beiden Seiten als
  verbunden gelten, ohne dass Daten fließen. Der Fahrer war dann bis zu 20 s
  blind und verpasste Aufträge, ohne es zu merken. Gegenmaßnahmen: der
  Herzschlag ist auf 10 s / 10 s verkürzt (`server.ts`), das Fahrer-Dashboard
  fordert seinen Stand aktiv über `driver:sync` an und **baut die Verbindung
  nach zwei erfolglosen Versuchen selbst neu auf**. Zusätzlich leitet der
  Server die Rolle aus dem Cookie ab, falls die Rollenangabe im Handshake
  fehlt (`auth={}` trat bei Wiederverbindungen auf – der Fahrer galt dann als
  anonymer Gast und bekam nie Daten). Abgesichert durch `scripts/qa/driver_sync.js`.
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

**Zugriff auf eine Fahrt (behoben 2026-08-24):** Frueher galt die interne
Buchungs-ID als gleichwertig zum Tracking-Token. Die ID steht aber in
PDF-Dateinamen und API-Antworten – wer sie kannte, konnte OHNE Anmeldung
Fahrtdaten lesen, stornieren, Ziel und Preis aendern, unterschreiben und ueber
`/pay` ein Trinkgeld auf die gespeicherte Karte des Fahrgasts buchen. Jetzt gilt:
nur der Token ist eine Capability (`bookingRefWhere`), die ID zaehlt
ausschliesslich mit passender Anmeldung (`bookingRefWhereCustomer` /
`...Company` / `...Driver`). Gilt auch fuer `track:join` und den Chat.

**Rate-Limit (behoben):** `clientIp()` las das ERSTE Element von
`x-forwarded-for` – das stammt vom Aufrufer. Mit `127.0.0.1` fiel der Schutz
komplett weg (Anmelde-Bruteforce, SMS-Kosten, Buchungs- und SOS-Spam). Jetzt
wird von RECHTS gezaehlt, gesteuert ueber `TRUSTED_PROXY_HOPS` (Render: 1).
Die Limits pro Benutzername und pro Zielrufnummer greifen zusaetzlich
**immer** – unabhaengig davon, ob eine IP feststellbar ist.

**Zugriffsprotokoll (behoben):** `AccessLog` hatte keine Mandantenspalte; jeder
Firmen-Admin las die letzten 200 Zugriffe ALLER Unternehmen auf Gesundheitsdaten
samt Dokumentnamen. Jetzt mit `companyId` (Migration `accesslog_tenant`) und
gefiltert. Altdatensaetze ohne Mandant bleiben bewusst unsichtbar.

**Festpreise (behoben 2026-08-25):** Die Festpreis-Regeln wurden bei Buchung
und Angebot ueber ALLE Firmen geladen – auch dann, wenn der Gast bereits eine
bestimmte Firma gewaehlt hatte. Damit verschob die Kalkulation fremder
Unternehmen die angezeigte Spanne und war nach aussen ablesbar. Jetzt zaehlt
die gewaehlte Firma; ohne Firma bleibt die plattformweite Sicht richtig, weil
dort jede Firma die Fahrt uebernehmen koennte.

**Weitere Luecken (behoben 2026-08-25):**
- `/api/geocode` war ein unbegrenzt offener Proxy auf einen kostenpflichtigen
  Kartendienst. Jetzt gedrosselt (120 Abfragen je IP und 10 Minuten, ohne
  feststellbare IP 30). Fuer Gaeste bleibt die Adresssuche offen.
- Das Storno-Protokoll pruefte `if (booking.companyId && ...)`. Eine Fahrt OHNE
  Firma rutschte durch und war fuer jedes Unternehmen lesbar.
- Die Anmeldungen der Portale (Veranstalter, Hotel, Einrichtung) hatten keinen
  Bruteforce-Schutz. Jetzt wie `/api/auth/login`: 20 Versuche je Konto und je
  IP in 5 Minuten, das Konto-Limit greift auch ohne feststellbare IP.
- `chat:send` behandelte jeden Nicht-Fahrer als Fahrgast. Eine Zentrale, die
  dem Verfolgungsraum beigetreten war, konnte im Namen des Fahrgasts
  schreiben. Der Chat laeuft ausdruecklich zwischen Fahrgast und Fahrer.

**Verfolgung war fuer Fahrgaeste tot (behoben 2026-08-25):** Die Absicherung
oben hatte eine Nebenwirkung, die niemandem auffiel, weil die Oberflaeche
denselben Fehler schon vorher hatte: `TrackingView` und `ChatPanel` verglichen
den Wert aus der Adresszeile – bei Gaesten der TOKEN – mit der Auftrags-ID aus
den Server-Ereignissen. Jedes Ereignis wurde verworfen. Der Fahrgast sah damit
weder den Wagen fahren noch eine aktualisierte Ankunftszeit noch eine einzige
Chatnachricht. Jetzt gelten Token und ID beide; die Chat-API liefert die
kanonische ID mit. Zusaetzlich kennt der Socket wieder eine Kundenidentitaet,
damit angemeldete Fahrgaeste ihre EIGENE Fahrt ueber die ID verfolgen duerfen –
Gaeste weiterhin ausschliesslich ueber den Token.

Abgesichert durch `scripts/qa/security_refs.js` (55 Pruefungen) und
`scripts/qa/tracking_eta.js` (13).

**Zweiter externer Bericht (behoben 2026-09-07):** Von 38 gemeldeten Punkten
waren 9 echt und sind behoben (`scripts/qa/haertung.js`, 31 Pruefungen):

- Das Kunden-Storno gab den ROHEN Fahrer-Datensatz zurueck - samt
  Passwort-Hash, Benutzername und Rufnummer. Jetzt nur noch das DTO. Alle
  anderen Routen mit Fahrerdaten nutzten das DTO bereits.
- Unterschrift: war vor der Fahrt moeglich, ueberschreibbar, ohne PNG- und
  Koordinatenpruefung. Jetzt erst waehrend/nach der Fahrt, einmalig, nur PNG,
  Koordinaten mit Weltgrenzen.
- Bewertung: war vor Fahrtende moeglich und beliebig oft ueberschreibbar.
- Firmenbudget: zwei gleichzeitige Buchungen sahen beide "Budget frei" und
  gaben zusammen mehr aus; ein Datenbankfehler beim Verbuchen wurde still
  geschluckt. Jetzt eine atomare, bedingte Verbuchung; reicht das Budget nicht
  mehr, wird die eben angelegte Fahrt wieder entfernt.
- Chat lieferte ab der 101. Nachricht die aeltesten statt der neuesten.
- Fahrer-Socket: Fantasie-Koordinaten und erfundene Statuswerte wurden
  uebernommen; Positionen ungedrosselt. Jetzt Weltgrenzen, Status nur aus
  FREI/PAUSE/OFFLINE, hoechstens eine Position je Sekunde.
- Zweites Geraet desselben Fahrers: eine getrennte Verbindung setzte ihn
  offline, obwohl die andere noch lief.
- Ohne Dispatcher gaben Storno und Buchung "ok" zurueck; jetzt 503, und eine
  Fahrt wird ohne Dispatcher gar nicht erst angelegt.
- Flugdaten: bei Anbieter-Ausfall galt die vom Client gemeldete Verspaetung.
  Jetzt die planmaessige Zeit ohne Verspaetung.
- Registrierung: Passwort mindestens 8 Zeichen (vorher 6), Firmen-
  Registrierung gedrosselt; STRIPE_WEBHOOK_SECRET ist im Echtbetrieb Pflicht.

Als FALSCH oder nicht zutreffend eingestuft: "Python-Proxy" und "/api/healthz"
(ein toter FastAPI-Rest einer frueheren Iteration, nirgends referenziert -
jetzt geloescht); firmenuebergreifende Vorbestellungen (bewusster
Marktplatz, seit 25.08. ohne Fahrgastdaten); alle Mehrinstanz-Punkte
(Redis-Adapter, Zeitgeber, Rate-Limit) - die Architektur ist auf GENAU EINE
Instanz festgelegt und dokumentiert; ALLOW_TEST_MODE_IN_PRODUCTION ist der
dokumentierte Probebetrieb mit lauter Meldung; der Trinkgeld-Weg ueber den
Verfolgungslink ist gewollt und durch Zeitfenster und Obergrenze begrenzt.
Offen gelassen (bewusst): E-Mail-Bestaetigung bei der Firmenregistrierung,
Widerruf laufender Sitzungen (JWT 7 Tage), Push-Schluessel als Pflicht.

**Dritter externer Bericht (behoben 2026-09-07):** Von den Punkten #39-55
waren fuenf echt; sie sind behoben (`scripts/qa/haertung.js`, jetzt 51
Pruefungen):

- Ein DEAKTIVIERTER Fahrer konnte sich weiterhin anmelden und Auftraege
  annehmen. Die Deaktivierung wirkte erst, wenn sein Anmelde-Ausweis nach
  sieben Tagen ablief. Jetzt greift sie an drei Stellen: die Anmeldung wird
  abgewiesen, der Echtzeitkanal prueft bei JEDEM Verbindungsaufbau nach, und
  beim Deaktivieren werden bestehende Verbindungen sofort getrennt und der
  Fahrer auf OFFLINE gesetzt.
- Ein GESPERRTES Kundenkonto konnte sich anmelden und sein Profil aendern -
  also E-Mail und Rufnummer austauschen und die Sperre so umgehen. Buchen war
  bereits gesperrt. Jetzt wird die Anmeldung abgewiesen; eine noch offene
  Sitzung darf lesen (der Kunde soll den Grund und seine Belege sehen), aber
  nichts mehr aendern.
- Zieländerung: Koordinaten wurden ohne Weltgrenzen uebernommen, beliebig oft
  und sogar nach der Bezahlung. Jetzt Weltgrenzen, hoechstens 300 km Luftlinie
  von der Abholung, hoechstens zehn Aenderungen je halbe Stunde und keine mehr,
  sobald abgerechnet ist.
- Beim Stripe-Aufruf brach gelegentlich der Verbindungsaufbau ab und liess eine
  beendete Fahrt UNBEZAHLT zurueck. Jetzt bis zu drei Wiederholungen mit
  20 Sekunden Zeitrahmen (Stripe erkennt Wiederholungen am Idempotenz-
  Schluessel, es wird nie doppelt abgebucht).

Der Verfolgungs-Token bleibt bewusst eine Capability (Punkt #39): ein Gast
ohne Konto hat nichts anderes. Missbrauch ist jetzt aber begrenzt statt
unbeschraenkt - siehe die drei Schranken oben.

**Auszahlungskonto (neu 2026-09-07):** Die Schnittstelle fuer Stripe Connect
war vollstaendig, aber es gab keine Oberflaeche dazu - keine Firma konnte ihr
Konto hinterlegen, und die Rueckkehr-Adresse aus dem Stripe-Onboarding zeigte
auf eine Seite, die es nicht gab. Neu: `/admin/auszahlung`
(`src/components/AdminPayout.tsx`) mit Status, offenen Nachweisen im Klartext,
Link ins Stripe-Dashboard und der Erklaerung des Geldflusses. Ausserdem
uebernimmt der Webhook jetzt `account.updated`: ohne das erfuhr die App nie,
dass eine Firma freigeschaltet wurde, und buchte weiter aufs Plattform-Konto.

**Vierter externer Bericht (#56-#108, behoben 2026-09-08).** Von 53 gemeldeten
Punkten waren rund 30 echt. Ein knappes Drittel der Liste betraf Stellen, die
beim zweiten und dritten Durchgang bereits behoben worden waren (Unterschrift,
Bewertung, Koordinaten bei Event- und Einrichtungsfahrten) - der Pruefer sah
einen aelteren Stand.

*Datenschutz:*

- **Der Krankenfahrten-Pool war das schwerste Leck.** Die Liste offener
  Krankenfahrten geht an ALLE Zentralen - auch an solche, die mit der Fahrt
  nichts zu tun haben und sie nie uebernehmen werden. Darin standen
  Patientenname, die Art der Fahrt (Dialyse, Onkologie ...), der Name der
  Einrichtung sowie Abhol- und Zieladresse vollstaendig. Das sind
  Gesundheitsdaten namentlich benannter Menschen, Art. 9 DSGVO. Jetzt enthaelt
  der Pool nur noch die grobe Lage (Postleitzahl und Ort), Zeit, Entfernung
  und die Anforderungen ans Fahrzeug - genug fuer die Entscheidung
  "kann ich das fahren?", zu wenig fuer alles andere. Alle Einzelheiten
  bekommt erst, wer die Fahrt tatsaechlich uebernimmt.
- Die Patientensuche schrieb den Suchbegriff ins Zugriffsprotokoll - gesucht
  wird unter anderem nach Versicherungsnummer. Damit lagen dieselben sensiblen
  Daten ein zweites Mal in der Datenbank. Jetzt wird nur noch vermerkt, DASS
  gesucht wurde.
- Der oeffentliche Firmen-Code verriet Restbudget, Restfahrten und das Limit je
  Fahrt - sowohl ueber die Schnittstelle als auch auf der QR-Landeseite. Wer
  einen Aufsteller fotografiert, konnte daraus die Ausgaben des Unternehmens
  ablesen. Jetzt kommt nur noch zurueck, ob der Code gilt.
- Vier CSV-Exporte (Krankenkassen-, Event-, Firmen- und Hotelabrechnung)
  maskierten Anfuehrungszeichen, aber nicht fuehrende `=`, `+`, `-`, `@`. Excel
  deutet solche Felder als FORMEL: ein Fahrgast, der sich `=HYPERLINK(...)`
  nennt, laesst seinen Text in der Abrechnung der Zentrale ausfuehren. Zentral
  behoben in `src/lib/csv.ts`.

*Konten und Rechte:*

- **Event-Unterkonten hatten alle Rechte des Hauptkontos.** Die Sitzung laeuft
  aus Gruenden der Mandantentrennung unter der Kennung des Veranstalters, und
  die Rolle wurde in KEINER Event-Route geprueft - eine Kraft mit der Rolle
  "Buchhaltung" konnte Rabattcodes anlegen, Firmen-Codes vergeben und Fahrten
  buchen. Auf der Hotel-Seite gab es die Pruefung laengst. Jetzt entscheidet
  `portalCan()` in 15 Event-Routen ueber jeden schreibenden Zugriff.
  Die Sitzungskennung bleibt bewusst die des Hauptkontos: sie traegt die
  Mandantentrennung, und ein Umbau darauf haette jede Abfrage im Portal
  beruehrt. Die Rechte haengen an `portalRole`.
- **Jeder konnte sich als Klinik eintragen** und bekam sofort ein aktives
  Konto, das Patientendaten anlegen und Krankenfahrten ausloesen darf. Im
  Echtbetrieb entsteht das Konto jetzt gesperrt; freigeschaltet wird es ueber
  `PATCH /api/super/institutions`, nachdem jemand die Einrichtung tatsaechlich
  geprueft hat. Im Test- und Entwicklungsbetrieb bleibt die Selbstfreischaltung
  an (`INSTITUTION_APPROVAL=0`), sonst liefe kein Testlauf durch.
- Fahrerpasswoerter durften vier Zeichen lang sein, Einrichtungspasswoerter
  sechs. Beides jetzt mindestens acht - dieselbe Untergrenze wie ueberall
  sonst. (Zwoelf Zeichen und ein zweiter Faktor waeren fuer Einrichtungen
  angemessen; das steht als offener Punkt in der Livegang-Checkliste.)
- Zwei Sitzungs-Cookies (Event-Registrierung, Einrichtungs-Anmeldung) wurden
  ohne `secure` gesetzt, waehrend die jeweilige Gegenstelle es korrekt tat.
- Ohne Ratenbremse waren: Event- und Einrichtungs-Registrierung, die
  Code-Pruefung, Sammelbuchungen (bis zu 30 Fahrten je Anfrage),
  Krankenfahrt-Schnellauftraege und die Unterschrift (knapp 2 MB je Anfrage).
  Alle haben jetzt eine.

*Geld:*

- **Doppelbelastung nach einem Absturz.** Zwischen der erfolgreichen Belastung
  bei Stripe und dem Vermerk "BEZAHLT" in der Datenbank liegt ein Moment.
  Stirbt der Prozess genau dort, galt die Fahrt weiter als offen und der
  naechste Anlauf buchte ein zweites Mal ab. Jetzt tragen Belastung und
  Reservierung einen Idempotenz-Schluessel aus Fahrt, Karte und Betrag: Stripe
  erkennt die Wiederholung und liefert das erste Ergebnis, ohne erneut zu
  belasten. Eine Zahlung mit einer ANDEREN Karte bleibt ein neuer Vorgang.
- Zwei gleichzeitige Anlaeufe konnten zwei Kartenreservierungen erzeugen, von
  denen nur eine in der Datenbank landete - die andere blockierte verwaist Geld
  auf der Karte. Der Vorgang wird jetzt vor dem Stripe-Aufruf beansprucht.
- `releaseHold()` loeschte die Vorgangsnummer auch dann, wenn die Freigabe bei
  Stripe fehlschlug. Danach wusste niemand mehr, welche Reservierung offen war.
  Jetzt wird nur bei Erfolg geloescht, sonst der Fehler vermerkt.
- Eine Firma mit laufendem Abo konnte mit `{"action":"new"}` einen zweiten
  Checkout starten und zwei Abos parallel bezahlen. Der Umweg ist entfernt;
  Tarifwechsel laufen ueber das Stripe-Kundenportal.
- Zwei gleichzeitige Anfragen konnten zwei Stripe-Kunden fuer dieselbe Firma
  bzw. denselben Fahrgast anlegen - bedingtes Schreiben verhindert das.
- Rabattcodes wurden geprueft und danach getrennt hochgezaehlt: bei maxUses 100
  und usedCount 99 bekamen zwei gleichzeitige Buchungen beide den Rabatt.
  Jetzt eine atomare, bedingte Verbuchung; scheitert die Buchung danach, wird
  der Code wieder freigegeben.
- Eine Zahlungsmethode wurde uebernommen, ohne bei Stripe zu pruefen, ob sie
  ueberhaupt zum Zahlungskonto dieses Fahrgasts gehoert.
- Das Entfernen einer Karte loeschte den lokalen Datensatz auch dann, wenn
  Stripe die Karte gar nicht geloest hatte.

*Betrieb:*

- Das Fahrerlimit des Tarifs wurde gezaehlt und danach angelegt: zwei
  gleichzeitige Anfragen kamen bei zehn erlaubten Fahrern auf elf. Da
  PostgreSQL keine Sperre auf "Anzahl Zeilen" kennt, wird jetzt nach dem
  Anlegen erneut gezaehlt und der ueberzaehlige Datensatz zurueckgenommen.
- Eine Sammelbuchung ueber 30 Taxis lief ohne Transaktion: schlug die 18. fehl,
  blieben 17 Fahrten stehen, waehrend die Anfrage einen Fehler meldete - beim
  zweiten Versuch standen 47 in der Datenbank. Jetzt alles oder nichts; die
  Vermittlung laeuft erst nach dem Festschreiben.
- Fehler der Vermittlung wurden mit `.catch(() => {})` verschluckt: die Fahrt
  stand in der Datenbank, niemand suchte einen Fahrer, und die Antwort meldete
  Erfolg. Betraf normale Fahrten, Event-Sammelbuchungen und
  Krankenfahrt-Schnellauftraege. Jetzt Protokoll und Alarm.
- Ein geschlossener Notruf hielt nur fest, DASS er erledigt wurde - nicht von
  wem. Jetzt mit eigenem Eintrag im Zugriffsprotokoll.
- Die Einrichtungs-Abrechnung ordnete Fahrten nach ANLAGEDATUM ein: eine am
  30.09. bestellte, am 05.10. gefahrene Fahrt landete in der
  September-Rechnung. Jetzt nach dem Leistungsdatum. Ausserdem zog sie die
  AKTUELLEN Firmendaten heran - eine Januar-Rechnung trug nach einem Umzug
  ploetzlich die neue Anschrift. Jetzt aus den Snapshot-Feldern, wie beim
  einzelnen Fahrtbeleg laengst ueblich.
- Die Event-Abrechnung summierte abgeschlossene Fahrten und Schaetzpreise zu
  einer Zahl, die wie eine Rechnungssumme aussah. Jetzt getrennt ausgewiesen
  und der Export protokolliert.
- "99:99" bestand die Pruefung einer Shuttle-Uhrzeit.

*Bewusst nicht geaendert:* Der Chat gibt neben dem Verfolgungs-Token weiterhin
die Auftragskennung zurueck (#88). Die Oberflaeche braucht sie, um eingehende
Ereignisse zuzuordnen; seit `bookingRefWhereCustomer` ist die Kennung allein
kein Zugang mehr. Ein eigener oeffentlicher Bezeichner waere sauberer und
steht auf der Liste, ist aber kein Livegang-Hindernis.

Geprueft durch `scripts/qa/haertung.js` (jetzt 78 Pruefungen).

**Fuenfter externer Bericht (#109-#176, behoben 2026-09-08).** Rund ein Drittel
der Liste war schon im vierten Durchgang erledigt (Einrichtungs-Registrierung,
Patienten-Koordinaten, Hotel-CSV, verschluckte Vermittlungsfehler) - der
Pruefer arbeitete erneut auf einem aelteren Stand. Der Rest war echt.

*Der uebergreifende Befund stimmt:* Das Rollenmodell der Portale ist sauber
definiert, aber die Routen wandten es nicht an. Im vierten Durchgang betraf das
die Event-Seite, jetzt die Hotel-Seite - und zwar dieselbe Luecke:

- Ein Concierge, der laut Modell ausschliesslich buchen darf, konnte die
  Monatsabrechnung oeffnen, **einen ganzen Monat als bezahlt markieren**,
  Gaestestammdaten lesen und die bevorzugten Taxiunternehmen aendern. Nur die
  Hotel-BUCHUNG pruefte `portalCan()`. Jetzt tun es auch Abrechnung,
  Gaesteliste und Einstellungen.
- Das Markieren eines Monats als bezahlt haelt jetzt fest, WER das wann getan
  hat - vorher stand dort nur "bezahlt".

*Weitere echte Befunde:*

- **Medizinische Nachweise: die interne Kennung war wieder ein Zugang.** Beim
  Hochladen wurde nur geprueft, ob die angegebene Fahrt oder Serie EXISTIERT -
  nicht, ob sie zum Absender gehoert. Wer eine fremde Kennung kannte, konnte
  eine aerztliche Verordnung an die Fahrt eines fremden Menschen haengen. Genau
  dieses Modell war bei den Buchungsrouten laengst entwertet worden; hier lebte
  es weiter. Jetzt: angemeldete Kunden und Einrichtungen nur auf ihre eigenen
  Vorgaenge, Gaeste ausschliesslich ueber den Verfolgungs-Token.
- **Ein einmal benutzter Verifizierungscode galt weiter.** `consumedAt` wurde
  gesetzt, aber nie geprueft - derselbe Code liess sich bis zum Ablauf beliebig
  oft gegen ein frisches Nachweis-Token eintauschen. Ausserdem hatte die Route
  keinerlei Bremse, obwohl jeder Versuch eine absichtlich rechenintensive
  Pruefung ausloest, und der Fehlversuchszaehler wurde erst NACH der Pruefung
  erhoeht: vier gleichzeitige Anfragen kamen gemeinsam am Limit vorbei.
- **Eine gesperrte Einrichtung arbeitete bis zu sieben Tage weiter** - die
  Sperre galt nur fuer neue Anmeldungen, der Ausweis im Browser lief weiter.
  Bei Patientenakten ist das nicht hinnehmbar; `src/lib/kontoAktiv.ts` prueft
  das jetzt bei jeder Anfrage (mit kurzem Zwischenspeicher).
- **Jeder konnte sich als Hotel eintragen** - wie zuvor bei den Einrichtungen.
  Passwort jetzt mindestens acht Zeichen, mit Ratenbremse.
- Der Verfolgungslink fiel auf die interne Kennung zurueck, wenn kein Token da
  war - ein Link, den der Gast anschliessend gar nicht verwenden darf.
- Stripe Connect konnte bei zwei gleichzeitigen Anfragen **zwei
  Auszahlungskonten** fuer dieselbe Firma anlegen.
- Beim **Loeschen eines Fahrers** wurde zuerst geprueft und danach geloescht;
  dazwischen konnte die Vermittlung ihm noch eine Fahrt zuweisen. Und die
  Verknuepfung wurde bei ALLEN Fahrten geleert, auch bei zehn Jahre alten -
  danach war nicht mehr feststellbar, wer eine Fahrt durchgefuehrt hat. Jetzt
  wird der Fahrer erst stillgelegt und getrennt, und Name und Kennzeichen
  werden vorher in die Fahrten geschrieben (`driverNameSnap`).
- Sicherheitsrelevante Fahreraenderungen (Krankenfahrten erlaubt, P-Schein,
  TUEV) werden protokolliert; die Nachweisfelder verlangen jetzt ein Datum
  statt beliebigen Text.
- Das Zugriffsprotokoll endete hart nach 200 Eintraegen - aeltere Zugriffe
  waren ueber dieses Werkzeug nicht mehr auffindbar. Jetzt mit Blaettern.
  Die Sichtbarkeitsluecke fuer Eintraege OHNE Firma bleibt BEWUSST bestehen:
  sie allen Zentralen zu zeigen waere ein Leck ueber Mandantengrenzen hinweg.
  Diese Zugriffe gehoeren in die Auskunft der Einrichtung und des
  Plattformbetreibers.
- Die Flug-Abfrage lief ohne erkennbare Adresse voellig ungebremst, obwohl
  jede Anfrage beim Anbieter Geld kostet. Die oeffentliche Zonensuche hatte
  ueberhaupt keine Bremse und keine feste Reihenfolge.
- Serienfahrten: "99:99" war eine gueltige Uhrzeit, Datumsangaben wurden
  ungeprueft uebernommen, "mit Rueckfahrt" ohne Rueckfahrzeit erzeugte
  stillschweigend nur die Hinfahrt (bei einer Dialysefahrt: der Patient kommt
  nicht nach Hause), und eine fehlende Fahrzeugklasse wurde automatisch zu
  ROLLSTUHL. Fehler einzelner Serien verschwanden in einem leeren `catch`.
- Hochgeladene Nachweise wurden nur nach der BEHAUPTUNG des Absenders geprueft;
  jetzt zusaetzlich anhand der ersten Bytes der Datei. Nachweise an einer
  Serie tauchten in der Prueflisten der Zentrale gar nicht auf.
- Die Patientenliste holte den kompletten Bestand ohne Obergrenze.
- Die Hotelabrechnung nutzte aktuelle statt historischer Firmendaten.
- Der Tarif-Datensatz entstand beim LESEN (GET) - jetzt ohne Rennen per upsert.
- Festpreisregeln nahmen Koordinaten ausserhalb der Erde an.
- Der stillgelegte Provisionsweg lieferte ueber `?format=json` weiterhin
  Provisionsbetraege aus dem alten Modell; die Felder sind jetzt entfernt.

*Bewusst nicht geaendert:* Preisparameter duerfen weiterhin 0 sein (#133) - das
ist eine legitime Entscheidung des Betreibers, kein Rechteproblem; eine
Rueckfrage in der Oberflaeche waere der richtige Ort dafuer. Die Sitzung eines
Portal-Unterkontos laeuft weiterhin unter der Kennung des Hauptkontos, weil sie
die Mandantentrennung traegt; die Rechte haengen an `portalRole`.

**Sechster externer Bericht (#177-#269, bearbeitet 2026-09-08).** Diesmal
gezielt Firmenchef, Fahrer und Fahrgast. Der schwerste Fund war eine
vollstaendige Angriffskette, und zwei Befunde haben sich bei der Pruefung als
Fehleinschaetzung erwiesen - dazu unten mehr, denn daraus folgt eine Regel fuer
kuenftige Berichte.

*Die Angriffskette (#236-#243, #266/#267):*

Die Liste offener Vorbestellungen liefert jedem Fahrer die internen Kennungen -
er musste also nichts erraten. Und `reserveScheduled()` nahm jede Kennung an:
geprueft wurde nur "ist eine Vorbestellung und hat noch keinen Fahrer". NICHT
geprueft wurden Betriebsart (der Krankenfahrten-Pool ist ausdruecklich der
Zentrale vorbehalten), Zustand (eine STORNIERTE Fahrt liess sich wieder auf
ZUGEWIESEN setzen), Fahrzeugklasse, Krankenbefoerderung, Rampe und Tragestuhl.
Ein Standardwagen ohne Krankenbefoerderung konnte sich damit eine Dialysefahrt
greifen. `assignFromPool()` hatte dieselbe Luecke von der anderen Seite: die
Zentrale konnte eine Krankenfahrt einem ungeeigneten Fahrer zuweisen, und zwei
gleichzeitige Zuweisungen gaben demselben Fahrer zwei Sofortfahrten - im
Speicher ueberlebte nur eine, die andere verschwand aus der Steuerung.

Jetzt gibt es EINE zentrale Eignungspruefung (`eignungPruefen`) fuer alle drei
Wege in eine Fahrt - automatische Vermittlung, Selbstreservierung, Zuweisung
durch die Zentrale - plus atomare Anspruchsnahme und eine Pruefung, dass der
Fahrer nicht schon eine Fahrt hat. Die offene Liste zeigt ausserdem nur noch
die grobe Lage statt vollstaendiger Anschriften (#265): sie ging plattformweit
an alle Fahrer und verriet faktisch "Wohnung X faehrt zum Dialysezentrum Y".

*Weitere echte Befunde:*

- **Die Fahrt hatte keine Zustandsmaschine (#189).** Die Reihenfolge steckte
  allein in den Schaltflaechen der App: ein manipulierter Client konnte direkt
  "abgeschlossen" senden, ohne je angekommen zu sein - und damit die gesamte
  Geldlogik ausloesen. Erlaubte Uebergaenge werden jetzt serverseitig erzwungen.
- **Doppelter Fahrtabschluss (#190).** Zwei fast gleichzeitige "beendet" liefen
  beide durch Abrechnung und Bonuspunkte; die Punkte wurden zweimal
  gutgeschrieben. Der Abschluss wird jetzt atomar beansprucht.
- **Storno konnte einen Abschluss ueberschreiben (#207/#208).** Zwischen der
  Pruefung in der Route und dem Schreibvorgang konnte der Fahrer die Fahrt
  beenden; das Storno machte daraus wieder STORNIERT - mitsamt Fahrpreis und
  Beleg. Die Bedingung steckt jetzt im UPDATE selbst.
- **Geloeschte Fahrer als Geister (#230/#231/#247).** Der Echtzeitkanal prueft
  beim Verbinden `active === false` - ein GELOESCHTER Fahrer lieferte `null`
  und kam durch, ebenso bei einem Datenbankfehler. Er landete danach sogar
  wieder im Arbeitsspeicher der Vermittlung, ohne in der Datenbank zu
  existieren. Jetzt fail-closed, und es entstehen keine Fahrer mehr aus dem
  Nichts.
- **Kartendaten im Verfolgungslink (#202).** Wer einen Link zu einer
  fehlgeschlagenen Kartenzahlung hatte, bekam Marke, letzte vier Ziffern und
  interne Kennung ALLER hinterlegten Karten des Kontos. Jetzt nur noch fuer den
  angemeldeten Karteninhaber.
- **Die Reitervermischung (#200/#201/#246)** hatte zwei gegenlaeufige
  Ursachen: `/api/auth/me` lieferte bei mehreren Anmeldungen immer den
  Firmenchef, der Echtzeitkanal immer den Fahrer - und der alte, rollenlose
  Ausweis blieb beim bereichsweisen Abmelden liegen, auf den beide
  zurueckfallen. Jetzt: kein generisches `session` mehr, der alte Ausweis wird
  immer entfernt, und bei mehreren Rollen muss der Client sagen, als wer er
  sich verbindet.
- Rueckfahrt: wurde immer als BARZAHLUNG angelegt, auch wenn die Hinfahrt die
  Firma oder die Karte zahlt (#183) - bei einer Krankenfahrt sollte der Patient
  ploetzlich selbst zahlen. Und ein Fehler beim Anlegen liess die Anfrage
  scheitern, obwohl die Hinfahrt schon vermittelt und per SMS bestaetigt war;
  der Fahrgast klickte erneut und hatte zwei Hinfahrten (#184).
- Eine Vorbestellung in der Vergangenheit wurde als Sofortfahrt vermittelt
  (#181), eine Rueckfahrt durfte vor der Hinfahrt liegen (#182).
- Die SMS-Bestaetigung liess sich umgehen: eine im Konto gespeicherte, NIE
  bestaetigte Nummer galt als bestaetigt, sobald sie mit der eingegebenen
  uebereinstimmte (#180).
- Weiter behoben: Buchung bei gekuendigter Firma (#209), Login mit einem Objekt
  statt Text (#253), gesperrte Kunden in der Kartenverwaltung (#214),
  Passwort-Durchprobieren im Profil (#254), Fahrer-Loeschen trennte die
  Verbindung BEVOR auffiel, dass eine Fahrt laeuft (#260), Stopp-Obergrenze bei
  der Zieländerung (#249), stiller Erfolg bei fehlgeschlagenem Statuswechsel
  (#188), Storno der Zentrale ohne Rueckmeldung (#229), Status nach Funkloch
  (#232), ungebremste Socket-Aufrufe (#233/#234), erfundene Fahraktionen
  (#248), Audit-Kategorie DRIVER statt BOOKING (#259), rohe Datensaetze im
  Fahrerdetail (#268).

*Zwei Befunde waren FALSCH - und der Weg dorthin ist die eigentliche Lehre:*

**#185 (angeblich kritisch): "Eine bei Firma A gebuchte Fahrt kann von Firma B
uebernommen werden, und der Preis wurde mit A's Tarif berechnet."** Der zweite
Teil stimmt nicht: `respondToOffer()` berechnet den Preis bei der Annahme mit
dem Tarif der ANNEHMENDEN Firma neu. Damit ist der Kern des Vorwurfs hinfaellig
- die Firmenkennung auf einer Fahrt ist der Ausgangspunkt, nicht eine Bindung.
Der firmenuebergreifende Marktplatz ist die Architektur, und fuer feste Flotten
gibt es `preferredCompanyIds`.

Ich hatte den Befund zunaechst uebernommen und eine harte Firmenbindung
eingebaut. Der Lasttest hat sie widerlegt: nur noch 60 von 120 Bestellungen
wurden rechtzeitig angenommen. Ein zweiter Versuch (gewaehlte Firma in den
ersten beiden Phasen bevorzugen) verzoegerte die Annahme um bis zu 30 Sekunden
und fiel ebenfalls durch. Beides wurde wieder entfernt.

**#193 (Fahrer kann sich waehrend der Fahrt selbst auf FREI setzen)** ist echt,
aber meine erste Fassung stuetzte sich auf die Merkliste im Arbeitsspeicher.
Die kann Eintraege enthalten, zu denen es keine laufende Fahrt mehr gibt - ein
Fahrer haette sich dann NIE wieder frei melden koennen und waere stumm aus der
Vermittlung gefallen. Geprueft wird jetzt die Datenbank, und nur bei einem
Fahrtstatus, der wirklich "unterwegs" bedeutet.

**Regel daraus:** Ein Befund wird erst uebernommen, wenn seine Begruendung im
Code nachgewiesen ist - nicht, weil er plausibel klingt. Und jede Aenderung an
der Vermittlung geht durch `loadtest_heavy`, bevor sie bleibt.


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
8. ~~Passwörter ändern wegen `test_credentials.md` im Git-Verlauf.~~
   **Berichtigt 2026-08-25:** Die Datei war nie committet, und der gesamte
   Verlauf (60 Commits) enthält keine echten Schlüssel – nur Platzhalter wie
   `sk_live_platzhalter` in einer Pruefreihe. Es ist nichts zu rotieren.

---

## 8b. Hosting – nicht verhandelbar

`render.yaml` stand zweimal auf `plan: free`. Das bedeutet:

- Der **Webdienst** wird nach 15 Minuten ohne Anfrage schlafen gelegt und
  braucht rund eine Minute zum Hochfahren. In dieser Zeit steht alles still:
  Vermittlung, Fahrt-Erinnerungen, Flugverspaetungen, automatische Abrechnung
  und die Live-Verbindungen der Fahrer. Nachts bestellt selten jemand – genau
  deshalb wartet der erste Nachtgast eine Minute.
- Die **Datenbank** wird 30 Tage nach dem Anlegen geloescht (danach 14 Tage
  Gnadenfrist), ohne Backup.

Beide stehen jetzt auf `starter`. **Das kostet Geld** – ohne ist ein
Echtbetrieb aber nicht moeglich. Ebenfalls ergaenzt: `TRUSTED_PROXY_HOPS=1`,
`DB_CONNECTION_LIMIT=10`, `APP_BASE_URL` und `ALLOWED_ORIGINS`.

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
| `driver_sync` | Fahrer-Dashboard bleibt nie ohne Auftragsstand |
| `security_refs` | Fahrt-Zugriff, Rate-Limit, Mandantentrennung, mobile Navigation |
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

## 9b. Startseite = Live-Karte

Seit 07.09.2026 ist die Live-Karte (`LiveTaxiMap`) die Startseite `/`. Wer
die Adresse aufruft, sieht sofort die verfuegbaren Taxis, sucht oben ein Ziel
und bestellt mit einem Tipp. Die fruehere Vorstellungsseite (Ablauf, Firmen-
Werbung) liegt unter `/info` und ist ueber den Info-Knopf oben links erreichbar.

Das Suchfeld oben liefert waehrend des Tippens Vorschlaege (300 ms Ruhe, dann
eine Anfrage an `/api/geocode`) - Adressen UND Orte wie "C&A" oder ein
Friseur, dank Places. Eine Auswahl fuehrt direkt ins Buchungsformular mit
gesetztem Ziel samt Koordinaten (`/buchen?to=&toLat=&toLng=`); der Fahrgast
tippt die Adresse kein zweites Mal. Pflichtlinks (Impressum, Datenschutz, AGB)
und die Zugaenge fuer Firmen/Fahrer stehen im unteren Bereich der Karte.

---

## 10a. Karte, Adresssuche, Routen: Google Maps

Seit 07.09.2026 ist Google Maps Platform der **einzige** Kartendienst. Leaflet,
Mapbox und LocationIQ sind entfernt. Aufbau:

- `src/lib/geoGoogle.ts`: Geocoding API (Adresse <-> Koordinate) und Routes API
  (Strecke, verkehrsabhaengige Fahrzeit, Streckenverlauf; auch Mehrziel).
  Server-Schluessel `GOOGLE_MAPS_API_KEY`, verlaesst den Server nie.
- `src/components/GoogleMap.tsx` / `GoogleLocationPicker.tsx`: die sichtbare
  Karte (Advanced Markers, Marker werden per id aktualisiert statt neu
  erzeugt). Browser-Schluessel `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, auf die
  Domain eingeschraenkt, wird beim Build eingebacken.
- `Map.tsx`/`LocationPicker.tsx`: ohne Schluessel ein klarer Hinweis statt
  leerer Flaeche. Die Startsperre lehnt den Echtbetrieb ohne beide
  Schluessel ab.
- Ohne Google-Schluessel greifen fuer Adresssuche/Routen die freien
  OSM-Dienste - NUR fuer Entwicklung und Pruefreihen (keine gewerbliche
  Nutzung erlaubt). Bei Google-Fehlern wird geschaetzt (Luftlinie x 1,35),
  nie auf die freien Dienste ausgewichen.

Geprueft: `scripts/qa/google_maps.js` (Weiche, Startsperre, Streckendekoder mit
Googles Beispielwert; mit Schluessel zusaetzlich echte Anfragen).

---

## 10b. Belege und Rechnungen

Alle vier Belegarten stellen im Namen des **Taxiunternehmens** aus, nicht der
Plattform: Fahrtbeleg (`ridePdf.ts`), Einrichtungs-Abrechnung
(`institutionPdf.ts`), Hotel-Abrechnung (`hotelStatementPdf.ts`) und seit
2026-08-25 auch die Firmenmobilitaet (`corporatePdf.ts`). Fahren in einem
Monat mehrere Unternehmen fuer denselben Empfaenger, entsteht je Unternehmen
ein eigener Rechnungsabschnitt mit eigener Nummer – jeder fuer sich buchbar.

Pflichtangaben auf jedem Abschnitt: Anschrift des Ausstellers, Steuernummer
bzw. USt-IdNr. (fehlt sie, steht ein Hinweis statt einer stillen Luecke),
Rechnungsnummer, Rechnungsdatum, USt-Ausweis, Zahlungsziel 14 Tage,
Empfaengeranschrift und Seitenzahlen. USt nach § 12 Abs. 2 Nr. 10 UStG:
7 % bis 50 km Befoerderungsstrecke, darueber 19 %. Trinkgeld wird getrennt
ausgewiesen und traegt keine USt.

Die Plattform (`platformIssuer.ts`) erscheint nur noch als Vermittlungshinweis
in der Fusszeile. Fuer `EventHost` kam dafuer ein Adressfeld dazu (Migration
`eventhost_address`), weil die Empfaengeranschrift ab 250 EUR Pflicht ist.

Geprueft wird der echte PDF-Code mit echten Daten: `scripts/qa/pdf_invoices.js`
erzeugt die Dokumente, liest ihren Text zurueck und rechnet die Betraege nach
(57 Pruefungen).

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

Erledigt am 2026-08-25: Mandantentrennung bei Festpreisen, Drosselung von
`/api/geocode`, Bruteforce-Schutz der Portale, Storno-Protokoll, Chat-Rollen,
die tote Fahrgast-Verfolgung, Rechnungen je Unternehmen fuer die
Firmenmobilitaet, Mengenbegrenzung der Zeitgeber und eine CI
(`.github/workflows/ci.yml`).

Ebenfalls am 2026-08-25 – die Punkte aus "ohne das nicht live gehen":

- **Ueberwachung** (`src/server/alarm.ts`): Alarme bei fehlgeschlagener
  Zahlung, SMS-Ausfall und verfallenen Auftraegen. Wege: Protokoll (immer),
  Webhook, E-Mail, optional Sentry. Gleiche Meldungen werden zusammengefasst,
  ein Alarm kann den Aufrufer nie stoeren. Beim Start meldet der Server
  ausdruecklich, wenn KEIN Weg eingerichtet ist.
- **Zustandspruefung** `/api/health` inklusive Datenbankverbindung.
- **Loeschkonzept technisch umgesetzt** (`src/server/retention.ts`), taeglich
  um 03:00 mit Protokoll. Fahrten und Fahrgastkonten sind standardmaessig
  ausgenommen, weil beides unumkehrbar ist; der Trockenlauf zeigt trotzdem an,
  wie viele Datensaetze betroffen waeren.
- **DSGVO-Papiere** unter `memory/DSGVO/`: Verarbeitungsverzeichnis,
  Loeschkonzept, TOM und die Liste der Auftragsverarbeiter mit dem, was
  abzuschliessen ist. Entwuerfe – anwaltlich pruefen lassen.
- **SMS-Sparprofil** (`SMS_PROFIL`): der Kostentreiber sind DREI Erinnerungen
  je Vorbestellung. `sparsam` (neuer Standard) laesst nur die 2-Stunden-
  Erinnerung uebrig und senkt eine Vorbestellung von ~6 auf ~4 SMS.
- **Marktplatz-Liste bereinigt**: die Liste offener Vorbestellungen ging mit
  vollem Datensatz an JEDEN Fahrer JEDER Firma – Name, Rufnummer, Adresse,
  auch fuer Fahrten, die niemand angenommen hatte. Jetzt nur noch Zeitpunkt,
  Strecke, Fahrzeugklasse und Preis.
- **Betriebshandbuch** `memory/BETRIEBSHANDBUCH.md`.

- **P1** Kunden können Name, E-Mail und Telefonnummer nicht selbst ändern
  (nur den Notfallkontakt). Für den Echtbetrieb nötig, auch wegen des Rechts
  auf Berichtigung.
- **P1** Push an Fahrer auf echten Geräten erproben (Schlüssel sind erzeugt).
- **P1** Probelauf mit einem echten Fahrer und echtem GPS.
- **P2** Sweep-N+1: der Dispatch holt pro beschaeftigtem Fahrer einzeln
  `booking.count` (dispatch.ts ~1514) – bei 100 Fahrern 100 serielle Abfragen
  alle 20 Sekunden. Ein `groupBy` genuegt.
- **P2** Preis-Lookups cachen: beim Annehmen wird dieselbe Firmenzeile dreimal
  gelesen (dispatch.ts ~675/678/685).
- **P2** Rohe Status-Werte in Hotel-, Einrichtungs- und Event-Portal
  (`FAHRT_LAEUFT` statt „Fahrt läuft"). Eine gemeinsame `StatusChip`-Komponente
  loest das an allen drei Stellen; `TRACKING_LABEL` existiert bereits.
- **P2** Barrierefreiheit: 130 `<label>`, davon nur 4 mit `htmlFor`; die
  Adress-Autovervollstaendigung ist ohne Maus nicht bedienbar. Fuer oeffentliche
  Traeger (Krankenfahrten) auch ein Vertriebsargument.
- **P2** Zwei Instanzen brauchen zusaetzlich einen Redis-Adapter fuer Socket.IO
  und einen gemeinsamen Rate-Limit-Speicher; der Dispatcher-Zustand ist
  prozesslokal.
- **P2** Preis kennzeichnen, wenn der Routendienst ausgefallen ist
  (Rückfall auf Luftlinie × 1,35 bei 30 km/h ist derzeit unsichtbar).
- **P3** Zweite Instanz + Redis-Adapter, sobald mehr als ~60 Fahrer gleichzeitig fahren.
- **P1** Ueberwachung fehlt vollstaendig: kein Sentry, keine Alarme auf
  fehlgeschlagene Zahlungen, nicht zugewiesene Fahrten oder SMS-Ausfaelle.
  Ohne das merkt niemand, wenn im Echtbetrieb etwas kippt.
- **P1** Loeschkonzept, Verzeichnis der Verarbeitungstaetigkeiten und
  Auftragsverarbeitungsvertraege (Stripe, Twilio, Hoster, Kartendienst).
  Bei Krankenfahrten sind das Gesundheitsdaten.
- ~~**P2** Kaskadenloeschung~~ **berichtigt am 26.08.2026:** `Booking.company`
  und `Booking.driver` stehen auf SetNull, Fahrten bleiben also erhalten. Nur
  Fahrer haengen per Cascade an der Firma – und die sind ueber die
  Schnappschuesse auf der Fahrt weiterhin nachvollziehbar. Die frueher hier
  notierte Warnung war falsch.
- **P2** Preisaenderungen sind nicht nachvollziehbar protokolliert (wer hat
  wann welchen Tarif geaendert).
- **P2** Betriebshandbuch: was tun bei Stripe-Ausfall, Twilio-Ausfall,
  Datenbank voll, Fahrer meldet falsche Abrechnung.
- **P2** Sicherung ist erst dann eine Sicherung, wenn eine Wiederherstellung
  einmal geprobt wurde.
- **P3** Enum-Werte sind deutsch (`STORNIERT`, `FAHRT_LAEUFT`). Fuer eine
  spaetere Internationalisierung muessten sie uebersetzt werden.
