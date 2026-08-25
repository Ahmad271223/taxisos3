# Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

> **Entwurf, keine Rechtsberatung.** Hier steht, was tatsächlich umgesetzt ist
> — und was nicht. Der Abschnitt „Bekannte Lücken" ist bewusst Teil des
> Dokuments: eine TOM-Liste, die nur Erfolge nennt, ist wertlos.

Stand: 25.08.2026.

---

## 1. Zugangskontrolle

- Getrennte Rollen-Cookies: `tc_admin`, `tc_driver`, `tc_customer`,
  `tc_hotel`, `tc_event`, `tc_institution`. Alle `httpOnly`, im Echtbetrieb
  zusätzlich `secure`. Kein Token im JavaScript erreichbar.
- Passwörter ausschließlich als bcrypt-Hash.
- Der Server **startet nicht**, wenn `AUTH_SECRET` kürzer als 32 Zeichen ist
  oder dem bekannten Standardwert entspricht. Diese Sperre ist nicht
  umgehbar — mit einem erratbaren Geheimnis ließen sich beliebige Sitzungen
  fälschen.
- Anmeldeversuche sind gedrosselt: 20 je Konto und je IP in 5 Minuten, für
  Firmen-, Fahrer-, Hotel-, Veranstalter- und Einrichtungszugänge. Das Limit
  pro Konto greift **auch dann**, wenn keine IP feststellbar ist — sonst ließe
  es sich durch Verschleiern der Herkunft aushebeln.

## 2. Zugriffskontrolle und Mandantentrennung

- Jede Abfrage von Fahrten, Fahrern und Dokumenten ist auf den Mandanten
  eingegrenzt. Kein Unternehmen sieht die Daten eines anderen.
- Der Zugriff auf eine Fahrt erfolgt über einen **Verfolgungs-Token**, nicht
  über die interne Auftrags-ID. Die ID steht in Dateinamen und Antworten; wer
  sie kennt, kommt damit **nicht** an die Fahrt. Die ID zählt nur zusammen mit
  einer passenden Anmeldung.
- Zugriffe auf medizinische Dokumente werden mandantengetrennt protokolliert
  (`AccessLog`).
- Die Marktplatz-Liste offener Vorbestellungen enthält **keine** Namen,
  Rufnummern oder medizinischen Angaben — nur Zeitpunkt, Strecke,
  Fahrzeugklasse und Preis. Name und Rufnummer erhält der Fahrer erst **nach**
  Annahme der Fahrt.

## 3. Übertragungskontrolle

- HTTPS im Echtbetrieb erzwungen; der Server startet ohne `APP_BASE_URL` und
  `ALLOWED_ORIGINS` nicht.
- Kartendaten werden **nie** entgegengenommen: die Karteneingabe läuft auf
  einer von Stripe gehosteten Seite. Gespeichert werden nur Referenz,
  Kartenmarke, letzte vier Ziffern und Ablaufdatum.

## 4. Eingabekontrolle

- Zugriffe auf Gesundheitsdaten sind protokolliert (Akteur, Aktion, Zeit).
- Stornierungen werden mit Grund und Urheber festgehalten (`CancellationLog`).
- **Lücke:** Preisänderungen sind nicht protokolliert. Wer wann welchen Tarif
  geändert hat, lässt sich nicht nachvollziehen.

## 5. Verfügbarkeit

- Zustandsprüfung unter `/api/health`, die auch die Datenbankverbindung
  prüft — ein Prozess ohne Datenbank wird damit nicht mehr als gesund geführt.
- Alarmierung bei fehlgeschlagenen Zahlungen, SMS-Ausfällen und verfallenen
  Fahrten über Protokoll, Webhook, E-Mail und optional Sentry.
- **Offen:** Sicherungen setzen einen bezahlten Hosting-Plan voraus, und eine
  Wiederherstellung wurde noch nie geprobt. Der Ablauf steht im
  Betriebshandbuch, Abschnitt 7.

## 6. Belastbarkeit

- Gemessen: eine Instanz trägt rund 40–60 gleichzeitig fahrende Fahrer.
  80 Fahrer mit 300 Fahrten führten zu einer Spitzenwartezeit von 20,7 s beim
  Verbindungsaufbau — vertretbar, aber die Obergrenze.
- Zeitgesteuerte Läufe (Erinnerungen, Flugabfragen) sind mengenbegrenzt und
  melden, wenn die Grenze greift, statt still Einträge zu übergehen.

## 7. Trennbarkeit

- Test- und Echtbetrieb sind getrennte Datenbanken.
- Ersatzverhalten („so tun, als hätte es geklappt") ist im Echtbetrieb
  vollständig gesperrt: ohne Zahlungsanbindung meldet jede Geldfunktion einen
  echten Fehler, statt „bezahlt" zu schreiben.

## 8. Löschung

Siehe `Loeschkonzept.md`. Umgesetzt als täglicher Lauf mit Protokoll.

---

## Bekannte Lücken

| Lücke | Wirkung | Zustand |
|---|---|---|
| `Company → Driver → Booking` löscht kaskadierend | Löschen eines Unternehmens entfernt abgerechnete Fahrten | Betrieblich abgesichert (nicht löschen, nur deaktivieren), technisch offen |
| Fahrgäste können Name, E-Mail, Telefon nicht selbst ändern | Recht auf Berichtigung nur manuell erfüllbar | Offen |
| Kein Datenexport für Betroffene | Art. 15/20 nur manuell | Offen |
| Keine Verschlüsselung einzelner Felder | Medizinische Dokumente liegen als Base64 in der Datenbank; geschützt ist die Datenbank als Ganzes | Bewusst, mit dem Anwalt zu bewerten |
| Unterschriften speichern Koordinaten | Standortdatum der unterschreibenden Person | Zu entscheiden, ob nötig |
| Keine Zwei-Faktor-Anmeldung für Firmen-Zugänge | Ein erbeutetes Passwort genügt für den Zugang zu Gesundheitsdaten | Offen, für Krankenfahrten erwägenswert |
