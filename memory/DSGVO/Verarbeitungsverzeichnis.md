# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)

> **Entwurf, keine Rechtsberatung.** Diese Datei hält fest, was die Software
> tatsächlich speichert, damit ein Anwalt oder Datenschutzbeauftragter darauf
> aufsetzen kann. Die Rechtsgrundlagen und Fristen sind begründete Vorschläge,
> keine geprüfte Rechtsauffassung. Vor der Verwendung prüfen lassen.

**Verantwortlicher:** IT Solutions by Ahmad Fakih, Baldurstraße 5,
30657 Hannover, USt-IdNr. DE462836430.

**Rolle:** Die Plattform vermittelt Fahrten zwischen Fahrgästen und
Taxiunternehmen. Für die **Beförderung** ist das jeweilige Taxiunternehmen
Verantwortlicher; für **Konto, Vermittlung und Zahlungsabwicklung** die
Plattform. Diese doppelte Rolle gehört in die Verträge mit den Unternehmen
(gemeinsame Verantwortlichkeit nach Art. 26 oder getrennte Verantwortlichkeit
– das ist die erste Frage an den Anwalt).

Stand: 25.08.2026.

---

## 1. Fahrgastkonten

| | |
|---|---|
| **Zweck** | Buchung, Wiedererkennung, Fahrtenhistorie, gespeicherte Zahlungsmittel |
| **Betroffene** | Fahrgäste mit Konto |
| **Daten** | `Customer`: Name, E-Mail, Telefonnummer, Passwort-Hash (bcrypt), Sperrstatus, Zeitpunkt der Telefonverifizierung |
| **Rechtsgrundlage** | Art. 6 Abs. 1 lit. b (Vertrag) |
| **Empfänger** | Das befördernde Taxiunternehmen (Name und Rufnummer, erst **nach** Annahme der Fahrt) |
| **Frist** | Löschung 24 Monate nach der letzten Fahrt oder auf Verlangen; abrechnungsrelevante Fahrtdaten bleiben davon unberührt (siehe Löschkonzept) |

## 2. Fahrten

| | |
|---|---|
| **Zweck** | Durchführung, Preisberechnung, Beleg, Nachweis |
| **Betroffene** | Fahrgäste, Fahrer |
| **Daten** | `Booking`: Name und Rufnummer des Bestellers, Abhol- und Zieladresse mit Koordinaten, Zwischenstopps, Zeitpunkte, Preis, Zahlungsstatus, Notizen, Fahrer-Schnappschuss (Name, Kennzeichen) |
| **Rechtsgrundlage** | Art. 6 Abs. 1 lit. b; für die Aufbewahrung Art. 6 Abs. 1 lit. c i. V. m. § 147 AO |
| **Empfänger** | Taxiunternehmen, Fahrer |
| **Frist** | 10 Jahre, soweit die Fahrt in eine Rechnung eingeht (§ 147 AO); danach Löschung |

## 3. Krankenfahrten — **besondere Kategorie (Art. 9)**

| | |
|---|---|
| **Zweck** | Durchführung von Krankenfahrten, Abrechnung mit Kostenträgern |
| **Betroffene** | Patientinnen und Patienten |
| **Daten** | `Booking`: `patientName`, `patientBirthDate`, `medicalType` (Dialyse, Reha, Krankenhaus, Arzt), `medicalEquipment` (Sauerstoff, Rollstuhl …), `insuranceName`; `InstitutionPatient`: Stammdaten; **`MedicalDocument`: Verordnungen, Genehmigungen, Rezepte als Datei (Base64) in der Datenbank** |
| **Rechtsgrundlage** | Art. 9 Abs. 2 lit. a (ausdrückliche Einwilligung) **oder** lit. h – hier ist eine anwaltliche Einordnung zwingend, weil davon die Einwilligungstexte abhängen |
| **Empfänger** | Nur das befördernde Unternehmen und die beauftragende Einrichtung |
| **Besonderheit** | Jeder Zugriff auf ein medizinisches Dokument wird in `AccessLog` protokolliert (mandantengetrennt) |
| **Frist** | Dokumente 12 Monate nach Ablauf ihrer Gültigkeit; Fahrtdaten wie unter 2. |

## 4. Unterschriften bei Krankenfahrten

| | |
|---|---|
| **Zweck** | Nachweis der Beförderung gegenüber dem Kostenträger |
| **Daten** | `RideSignature`: Unterschriftsbild (PNG, Base64), Name, **Koordinaten und Zeitpunkt der Unterschrift** |
| **Rechtsgrundlage** | Art. 6 Abs. 1 lit. b und lit. c |
| **Hinweis** | Die gespeicherten Koordinaten sind ein Standortdatum der unterschreibenden Person. Wenn der Nachweis auch ohne Ortsangabe genügt, sollten sie entfallen – das ist eine bewusste Entscheidung, die dokumentiert gehört. |
| **Frist** | Wie die zugehörige Fahrt |

## 5. Fahrerkonten und Standortdaten

| | |
|---|---|
| **Zweck** | Vermittlung, Live-Karte für Zentrale und Fahrgast, Ankunftszeit |
| **Betroffene** | Fahrerinnen und Fahrer |
| **Daten** | `Driver`: Benutzername, Passwort-Hash, Name, Rufnummer, Fahrzeugangaben, **aktuelle Position (`lat`, `lng`, `speed`)** |
| **Rechtsgrundlage** | Art. 6 Abs. 1 lit. b; bei angestellten Fahrern zusätzlich § 26 BDSG – **Mitbestimmung beachten**, Standortverfolgung von Beschäftigten ist regelmäßig betriebsratspflichtig |
| **Besonderheit** | Die Position wird **nicht historisiert**: es gibt kein Bewegungsprofil, nur den jeweils letzten Stand |
| **Frist** | Position lebt nur im laufenden Betrieb; Konto bis zur Löschung durch das Unternehmen |

## 6. Zahlungsdaten

| | |
|---|---|
| **Zweck** | Kartenzahlung, Hinterlegung eines Zahlungsmittels, Auszahlung an die Unternehmen |
| **Daten** | `CustomerCard`: **nur** Stripe-Referenz, Kartenmarke, letzte vier Ziffern, Ablaufdatum. Vollständige Kartennummern werden **nie** gespeichert oder auch nur entgegengenommen (Stripe-eigene Seite) |
| **Rechtsgrundlage** | Art. 6 Abs. 1 lit. b |
| **Empfänger** | Stripe Payments Europe Ltd. (Auftragsverarbeiter) |
| **Frist** | Bis zur Entfernung durch den Fahrgast; Zahlungsbelege 10 Jahre |

## 7. Benachrichtigungen

| | |
|---|---|
| **Zweck** | Buchungsbestätigung, „Fahrer unterwegs", Erinnerung an Vorbestellungen |
| **Daten** | `SmsLog`: **Rufnummer und vollständiger Nachrichtentext**, Status, Fehler; `PushSubscription`: Endpunkt und Schlüssel |
| **Rechtsgrundlage** | Art. 6 Abs. 1 lit. b |
| **Empfänger** | Twilio (SMS), Resend (E-Mail) |
| **Frist** | 90 Tage – der Text enthält Adressen und ist damit kein reines Zustellprotokoll |

## 8. Zugriffs- und Sicherheitsprotokolle

| | |
|---|---|
| **Zweck** | Nachweis, wer auf Gesundheitsdaten zugegriffen hat; Missbrauchserkennung |
| **Daten** | `AccessLog`: Akteur, Aktion, betroffener Datensatz, Zeitpunkt, Mandant |
| **Rechtsgrundlage** | Art. 6 Abs. 1 lit. c i. V. m. Art. 32 |
| **Frist** | 12 Monate |

## 9. Notruf (SOS)

| | |
|---|---|
| **Zweck** | Hilfe in einer Notlage während der Fahrt |
| **Daten** | `SosAlert`: Name, Rufnummer, Position, Nachricht |
| **Rechtsgrundlage** | Art. 6 Abs. 1 lit. d (lebenswichtige Interessen) |
| **Frist** | 12 Monate |

## 10. Geschäftskunden-Portale (Hotels, Einrichtungen, Veranstalter)

| | |
|---|---|
| **Daten** | `Hotel`/`HotelGuest`, `Institution`/`InstitutionPatient`, `EventHost`/`EventGuest`, `PortalUser` – Ansprechpartner, Gästenamen, Zimmernummern |
| **Rechtsgrundlage** | Art. 6 Abs. 1 lit. b |
| **Frist** | Wie die zugehörigen Fahrten |

---

## Drittlandtransfer

Stripe, Twilio und Resend haben US-Mutterkonzerne. Für alle drei sind
EU-Standardvertragsklauseln bzw. die Zertifizierung nach dem EU-US Data
Privacy Framework die Grundlage. Das ist **vor** dem Livegang je Anbieter
schriftlich nachzuhalten (siehe `Auftragsverarbeiter.md`).

## Betroffenenrechte — ehrlicher Stand

- **Auskunft (Art. 15):** nur manuell aus der Datenbank. Kein Selbstbedienungs-Export.
- **Berichtigung (Art. 16):** Seit dem 26.08.2026 können Fahrgäste Name,
  E-Mail und Telefonnummer selbst ändern (Konto → „Meine Daten"). E-Mail und
  Rufnummer verlangen das Passwort; eine neue Rufnummer wird per SMS bestätigt.
  Alte Fahrten und Belege bleiben unverändert (Schnappschussfelder).
- **Löschung (Art. 17):** siehe `Loeschkonzept.md`; derzeit manuell.
- **Datenübertragbarkeit (Art. 20):** nicht umgesetzt.
