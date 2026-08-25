# Löschkonzept

> **Entwurf, keine Rechtsberatung.** Die Fristen sind begründete Vorschläge.
> Steuerliche Aufbewahrung (§ 147 AO, § 257 HGB) und Datenschutz ziehen in
> entgegengesetzte Richtungen; wo beides zusammentrifft, gewinnt die
> gesetzliche Aufbewahrungspflicht. Vor der Verwendung prüfen lassen.

Stand: 25.08.2026.

---

## Grundsatz

Es gibt zwei Sorten von Daten, und sie werden unterschiedlich behandelt:

1. **Abrechnungsrelevant** — alles, was in eine Rechnung eingeht: Fahrt,
   Preis, Beleg, Zahlungsvorgang. Aufbewahrung **10 Jahre** (§ 147 Abs. 3 AO).
   Diese Daten werden **nicht** gelöscht, auch nicht auf Verlangen; das ist
   nach Art. 17 Abs. 3 lit. b DSGVO zulässig.
2. **Alles Übrige** — Protokolle, Benachrichtigungstexte, Dokumente, Konten.
   Hier gilt: so kurz wie möglich.

Ein Löschverlangen nach Art. 17 führt deshalb zur **Anonymisierung** des
Kontos, nicht zum Verschwinden der Fahrten: Name, E-Mail und Rufnummer werden
ersetzt, die Fahrt bleibt als Beleg bestehen.

---

## Fristen im Einzelnen

| Daten | Frist | Grundlage |
|---|---|---|
| `SmsLog` (Rufnummer **und Nachrichtentext**) | 90 Tage | Der Text enthält Adressen; ein Zustellnachweis braucht ihn nicht dauerhaft |
| `AccessLog` (Zugriffe auf Gesundheitsdaten) | 12 Monate | Nachweiszweck nach Art. 32 |
| `CancellationLog` | 12 Monate | Streitfälle sind bis dahin geklärt |
| `SosAlert` | 12 Monate | Nachvollziehbarkeit von Notfällen |
| `Verification` (SMS-Codes) | 24 Stunden | Zweck endet mit der Bestätigung |
| `MedicalDocument` | 12 Monate nach Ablauf der Gültigkeit | Art. 9 – so kurz wie vertretbar |
| `ChatMessage` | 12 Monate | Kein Nachweiszweck darüber hinaus |
| Fahrgastkonto ohne Fahrt in 24 Monaten | Anonymisierung | Zweck entfallen |
| `Booking` mit Rechnungsbezug | 10 Jahre | § 147 AO |
| `Booking` ohne Rechnungsbezug (storniert, nie gefahren) | 12 Monate | Kein Aufbewahrungsgrund |
| `RideSignature` | wie die zugehörige Fahrt | Nachweis gegenüber dem Kostenträger |
| Fahrerkonto nach Austritt | Anonymisierung nach 12 Monaten | Fahrtzuordnung bleibt über den Schnappschuss erhalten |

---

## Warum der Fahrer-Schnappschuss wichtig ist

Auf jeder Fahrt werden **Name und Kennzeichen des Fahrers als Kopie**
gespeichert (`driverNameSnap`, `driverPlateSnap`). Dadurch bleibt nach der
Löschung eines Fahrerkontos nachvollziehbar, wer gefahren ist — ohne dass das
Konto selbst aufbewahrt werden müsste. Genau dafür ist es da.

---

## Offener Punkt: Kaskadenlöschung

Heute gilt in der Datenbank `Company → Driver → Booking` mit `onDelete:
Cascade`. Wird ein Unternehmen gelöscht, verschwinden **auch abgerechnete
Fahrten**. Das verletzt die steuerliche Aufbewahrungspflicht und macht
Rechnungen unbelegbar.

**Bis das auf ein Soft-Delete umgestellt ist, gilt betrieblich:** kein
Unternehmen und keinen Fahrer löschen, für die es abgerechnete Fahrten gibt.
Stattdessen deaktivieren (`active = false`). Der Punkt steht auch im
Betriebshandbuch unter „Was niemals passieren darf".

---

## Umsetzung

Die zeitgesteuerte Löschung läuft täglich um 03:00 Uhr
(`src/server/retention.ts`, eingehängt in `scheduler.ts`). Sie protokolliert,
was sie gelöscht hat; ohne Protokoll ließe sich später nicht belegen, dass das
Konzept auch angewendet wurde.

Abschaltbar über `RETENTION_AKTIV=0` — dann meldet der Start ausdrücklich,
dass keine Löschung läuft. Einzelne Fristen sind über Umgebungsvariablen
einstellbar (siehe Dateikopf).

**Trockenlauf** vor der ersten Anwendung:

```bash
RETENTION_TROCKEN=1 npx tsx scripts/retention_run.ts
```

Zeigt, was gelöscht **würde**, ohne etwas zu ändern.
