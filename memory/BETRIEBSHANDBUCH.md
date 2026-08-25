# Betriebshandbuch TaxiOS

Für den laufenden Echtbetrieb. Kein Konzeptpapier, sondern: **was tue ich,
wenn X passiert.** Jeder Abschnitt nennt zuerst das Erkennungsmerkmal, dann
die Sofortmaßnahme, dann die Ursachensuche.

Stand: 25.08.2026. Betreiber: IT Solutions by Ahmad Fakih, Baldurstraße 5,
30657 Hannover, USt-IdNr. DE462836430.

---

## 0. Erste Handgriffe bei jeder Störung

**Läuft der Dienst überhaupt?**

```bash
curl -s https://<domain>/api/health
```

Antwortet `{"ok":true,...}`, laufen Prozess **und** Datenbankverbindung.
`503` heißt: der Prozess lebt, kommt aber nicht an die Datenbank – dann direkt
zu Abschnitt 3. Keine Antwort heißt: der Prozess ist tot, dann Abschnitt 5.
Auf Render gehört dieser Pfad in **Health Check Path**, sonst merkt der Hoster
einen Prozess ohne Datenbank nicht.

```bash
npx tsx scripts/check_state.ts
```

Zeigt alle aktiven Fahrer mit Status und die Aufträge nach Status. Sind dort
viele Aufträge in `OFFEN`, aber Fahrer auf `FREI`, ist die Vermittlung gestört
(Abschnitt 4). Ist die Liste leer, kommt der Prozess nicht an die Datenbank
(Abschnitt 3).

Serverprotokoll ist die zweite Quelle. Auf Render: Dashboard → Service → Logs.
Nach diesen Zeichenketten suchen:

| Suchbegriff | Bedeutung |
|---|---|
| `LIVEGANG ABGEBROCHEN` | Startsperre hat den Start verweigert (Abschnitt 8) |
| `EADDRINUSE` | Alte Instanz läuft noch, neue kommt nicht hoch |
| `WorkerError` | Next-Worker abgestürzt, Seiten liefern 500 |
| `Erinnerungen: Obergrenze` | Mehr fällige Vorbestellungen als ein Lauf schafft |
| `Flugabfrage: Obergrenze` | Mehr Flugfahrten als ein Lauf schafft |
| `Adresssuche ohne erkennbare Client-IP` | `TRUSTED_PROXY_HOPS` falsch |

---

## 1. Stripe fällt aus

**Erkennungsmerkmal:** Fahrten enden, aber `paymentStatus` bleibt
`FEHLGESCHLAGEN`; im Protokoll stehen Stripe-Fehler; Fahrer melden „Zahlung
hat nicht geklappt".

**Wichtig zu wissen:** Das System **erfindet keinen Erfolg**. Ohne
Stripe-Verbindung meldet jede Geldfunktion im Echtbetrieb einen echten Fehler,
statt „bezahlt" in die Datenbank zu schreiben (abgesichert durch
`scripts/qa/no_fake_success.js`). Es geht also kein Geld verloren und es
entstehen keine Falschbuchungen – die Fahrten bleiben offen.

**Sofort:**
1. Auf [status.stripe.com](https://status.stripe.com) prüfen, ob es an Stripe
   liegt.
2. Liegt es nicht an Stripe: Schlüssel prüfen. Ein abgelaufener oder
   zurückgezogener `STRIPE_SECRET_KEY` sieht genauso aus wie ein Ausfall.
3. Betroffene Unternehmen informieren, dass Kartenzahlungen vorübergehend
   nicht durchgehen und **bar kassiert** werden soll.

**Danach:** Offene Fahrten nachbuchen. Sie stehen auf `FEHLGESCHLAGEN` und
haben eine hinterlegte Karte; der Einzug lässt sich erneut auslösen. Nicht
mehrfach anstoßen – die Sperre (`settlingAt`) verhindert Doppelbuchungen,
aber ein manuelles Umschreiben in der Datenbank umgeht sie.

**Prüfskript:** `node scripts/e2e_stripe_live.js`

---

## 2. Twilio fällt aus / SMS kommen nicht an

**Erkennungsmerkmal:** Fahrgäste melden, dass keine Bestätigung kam. Im
Protokoll Twilio-Fehlercodes.

**Wichtig zu wissen:** SMS sind **nicht** kritisch für den Ablauf. Fahrten
werden weiterhin vermittelt, gefahren und abgerechnet. Es fehlt nur die
Benachrichtigung.

**Sofort:**
1. `node scripts/qa/twilio_delivery.js` – zeigt Kontostand, verifizierte
   Nummern und verschickt eine Testnachricht.
2. Häufigste Ursache im Trial-Konto: **Empfänger nicht verifiziert**. Im
   bezahlten Konto: **Guthaben aufgebraucht**.
3. Notbetrieb: `SMS_DISABLED=1` setzen. Dann werden SMS gar nicht erst
   versucht, das Protokoll bleibt lesbar und es entstehen keine Kosten für
   fehlschlagende Versuche.

**Kostenrahmen zur Einordnung:** Eine Sofortfahrt löst 3 SMS aus (≈ 0,25 €),
eine Vorbestellung 6 (≈ 0,49 €). Bei 1.200 Fahrten im Monat sind das rund
292 € – mehr als die 100 € Abo-Einnahme im Tarif P5. Steigen die Kosten
unerwartet, zuerst prüfen, ob Erinnerungen doppelt laufen.

---

## 3. Datenbank nicht erreichbar oder voll

**Erkennungsmerkmal:** `check_state.ts` bricht ab; im Protokoll
`P1001`/`P1017` (keine Verbindung) oder `53100` (Speicherplatz erschöpft).

**Sofort bei „voll":**
1. Auf Render den Speicher des Postgres-Dienstes vergrößern. Das ist der
   einzige schnelle Weg; Löschen schafft in Postgres nicht sofort Platz frei.
2. Danach aufräumen: alte `AccessLog`- und `CancellationLog`-Einträge sind die
   üblichen Wachstumstreiber.

**Niemals** Fahrten löschen, um Platz zu schaffen. Sie sind Grundlage der
Abrechnung und der Rechnungen. Siehe auch Abschnitt 9.

---

## 4. Fahrten werden nicht vermittelt

**Erkennungsmerkmal:** Aufträge stehen auf `OFFEN`, obwohl Fahrer auf `FREI`
stehen.

**Reihenfolge der Prüfung:**
1. **Sind die Fahrer wirklich verbunden?** `FREI` in der Datenbank heißt
   nicht verbunden. Der Dispatcher berücksichtigt nur Fahrer mit offener
   Verbindung und aktueller Position.
2. **Position vorhanden?** Ohne `lat`/`lng` fällt ein Fahrer aus jeder Suche.
   Häufigste Ursache: Standortfreigabe im Browser des Fahrers verweigert.
3. **Entfernung.** Die Suche läuft in Stufen: 500 m → 1 → 2 → 3 → 5 km. Weiter
   entfernte Fahrer bekommen **nie** ein Angebot.
4. **Abo-Status der Firma.** Ist das Abo nicht `AKTIV`, nimmt die Firma nicht
   an der Vermittlung teil.
5. **Fahrzeugklasse und Freigaben.** Krankenfahrten brauchen `medicalAllowed`,
   Rollstuhlfahrten `hasRamp`.

**Notbehelf:** Die Zentrale kann im Admin-Dashboard einen Fahrer von Hand
zuweisen. Das umgeht die Suche vollständig.

---

## 5. Server startet nicht

**Erkennungsmerkmal:** Deploy schlägt fehl oder der Dienst startet in einer
Schleife neu.

1. **`LIVEGANG ABGEBROCHEN` im Protokoll** → die Startsperre hat bewusst
   abgebrochen. Die Meldung nennt die fehlende Einstellung. Das ist kein
   Fehler, sondern Absicht: siehe Abschnitt 8.
2. **`EADDRINUSE`** → eine alte Instanz hält den Port. Auf Render löst ein
   erneutes Deploy das; lokal die alten Node-Prozesse beenden.
3. **Prisma-Fehler beim Start** → Migrationen laufen nicht mit dem Code
   zusammen. `npm run db:migrate` gegen die richtige Datenbank ausführen.

---

## 6. Fahrer meldet eine falsche Abrechnung

1. **Beleg holen.** Der Fahrtbeleg nennt Aussteller, Strecke, USt-Satz,
   Fahrpreis und Trinkgeld getrennt.
2. **Strecke prüfen.** Der USt-Satz hängt an der Strecke: 7 % bis 50 km,
   darüber 19 % (§ 12 Abs. 2 Nr. 10 UStG). Eine Fahrt knapp über 50 km sieht
   für den Fahrer nach einem Fehler aus, ist aber richtig.
3. **Trinkgeld** ist kein Entgeltbestandteil und trägt keine USt. Es wird auf
   dem Beleg getrennt ausgewiesen.
4. **Festpreis?** Steht `priceIsFixed`, galt eine Festpreis-Regel der Firma –
   dann weicht der Betrag bewusst vom Taxameter-Ergebnis ab.
5. **Der Fahrpreis geht zu 100 % an das Unternehmen.** Es gibt keine
   Provision je Fahrt; die Plattform verdient ausschließlich am Monatsabo.
   Wer eine „fehlende" Differenz sucht, sucht etwas, das es nicht gibt.

---

## 7. Sicherung und Wiederherstellung

**Eine Sicherung ist erst dann eine Sicherung, wenn eine Wiederherstellung
einmal geprobt wurde.** Das steht hier, weil es der am häufigsten
übersprungene Schritt ist.

Zu proben, **bevor** echte Kunden im System sind:

1. Auf Render einen Wiederherstellungspunkt der Datenbank auswählen.
2. In eine **neue** Datenbank zurückspielen, nicht über die laufende.
3. `DATABASE_URL` einer Testinstanz darauf zeigen lassen.
4. `npx tsx scripts/check_state.ts` – sind Fahrer und Aufträge da?
5. Eine Testfahrt buchen und abschließen.
6. Die gemessene Dauer notieren. Diese Zahl ist die Antwort auf „wie lange
   sind wir im Ernstfall offline".

Erst mit einem bezahlten Render-Plan gibt es überhaupt
Wiederherstellungspunkte. Der kostenlose Plan hat keine.

---

## 8. Startsperre absichtlich ausgelöst

`src/server/liveGuard.ts` bricht den Start im Echtbetrieb ab, wenn
Einstellungen fehlen, die Geld oder Sicherheit betreffen. Ein zu kurzes oder
das bekannte Standard-`AUTH_SECRET` lässt sich **nicht** übergehen – auch
nicht über den Notausgang. Das ist so gewollt: mit einem erratbaren Geheimnis
kann jeder beliebige Sitzungen fälschen.

Die Meldung nennt jeweils den fehlenden Schlüssel. Nichts davon „schnell
umgehen" – jeder dieser Punkte hat einen konkreten Schaden dahinter.

---

## 9. Was niemals passieren darf

- **Fahrten löschen**, um Platz oder Ordnung zu schaffen. Sie sind
  Rechnungsgrundlage. (Offener Punkt: `Company → Driver → Booking` löscht
  derzeit kaskadierend mit; bis das auf Soft-Delete umgestellt ist, kein
  Unternehmen und keinen Fahrer löschen, für die es abgerechnete Fahrten gibt.)
- **Zahlungsstatus von Hand in der Datenbank umschreiben.** Die Sperre gegen
  Doppelbuchungen greift nur über den regulären Weg.
- **`AUTH_SECRET` im laufenden Betrieb ändern.** Alle Anmeldungen fliegen
  sofort raus – Fahrer mitten in der Fahrt eingeschlossen.
- **Migrationen von Hand in der Datenbank nachziehen.** Nur über
  `prisma migrate deploy`, sonst passen Code und Schema auseinander.

---

## 10. Was noch fehlt (ehrlich)

- **Keine Überwachung.** Kein Sentry, keine Alarme bei fehlgeschlagenen
  Zahlungen, nicht zugewiesenen Fahrten oder SMS-Ausfällen. Heute merkt eine
  Störung nur, wer zufällig hinschaut oder wen ein Kunde anruft. Das ist der
  wichtigste offene Punkt in diesem Handbuch.
- **Kein Prüfpfad für Preisänderungen** (wer hat wann welchen Tarif geändert).
- Eine Instanz trägt rund 40–60 gleichzeitig fahrende Fahrer. Darüber braucht
  es eine zweite Instanz mit Redis-Adapter für Socket.IO und einen gemeinsamen
  Rate-Limit-Speicher; der Dispatcher-Zustand liegt derzeit im Prozess.
