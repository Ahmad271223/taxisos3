# Auftragsverarbeiter — was abzuschließen ist

> **Entwurf, keine Rechtsberatung.** Diese Liste sagt, **wer** welche Daten
> bekommt und **was** deshalb zu unterzeichnen ist. Die Verträge selbst
> schließt du ab; sie liegen bei den Anbietern zum Abruf bereit.

Stand: 25.08.2026. Verantwortlicher: IT Solutions by Ahmad Fakih.

---

## Warum das nicht optional ist

Ohne Auftragsverarbeitungsvertrag ist jede Weitergabe an diese Dienste eine
Übermittlung ohne Rechtsgrundlage. Bei Krankenfahrten geht es dabei um
Gesundheitsdaten — der Bußgeldrahmen liegt bei bis zu 4 % des Jahresumsatzes,
und die Aufsichtsbehörden prüfen genau dort besonders genau.

---

## 1. Stripe Payments Europe, Ltd. (Irland)

| | |
|---|---|
| **Zweck** | Kartenzahlung, hinterlegte Zahlungsmittel, Auszahlung an die Taxiunternehmen |
| **Daten** | Name, E-Mail, Betrag, Kartenreferenz. **Keine Kartennummern über unsere Systeme** — die Eingabe erfolgt auf einer Stripe-Seite |
| **Abzuschließen** | Der AV-Vertrag ist Teil der Stripe Services Agreement (Data Processing Agreement). Im Dashboard unter Einstellungen → Compliance annehmen und als PDF ablegen |
| **Drittland** | US-Mutterkonzern; Standardvertragsklauseln in der Stripe-DPA enthalten |
| **Besonderheit** | Stripe ist bei den Auszahlungen an die Unternehmen **eigenständig verantwortlich** (Connect). Das gehört in den Vertrag mit den Taxiunternehmen. |

## 2. Twilio Ireland Limited

| | |
|---|---|
| **Zweck** | SMS an Fahrgäste |
| **Daten** | **Rufnummer und vollständiger Nachrichtentext** — der Text enthält Abholadresse und Verfolgungslink |
| **Abzuschließen** | Twilio DPA über die Console (Legal → Data Protection Addendum) annehmen und ablegen |
| **Drittland** | US-Mutterkonzern; SCC in der DPA |
| **Hinweis** | Weil der Nachrichtentext Adressdaten enthält, ist das mehr als eine reine Zustellung. Das gehört ausdrücklich ins Verarbeitungsverzeichnis (Punkt 7). |

## 3. Resend (E-Mail)

| | |
|---|---|
| **Zweck** | Rechnungsversand, Alarm-Mails |
| **Daten** | E-Mail-Adresse, Rechnungs-PDF (enthält Name und Anschrift) |
| **Abzuschließen** | DPA bei Resend anfordern |
| **Drittland** | USA — hier besonders sorgfältig prüfen, ob eine EU-Ansässigkeit angeboten wird |

## 4. Hosting (Render)

| | |
|---|---|
| **Zweck** | Betrieb von Anwendung und Datenbank |
| **Daten** | **Alle** — Datenbank und Protokolle |
| **Abzuschließen** | Render DPA; **Region ausdrücklich Frankfurt (EU) wählen**, nicht die Voreinstellung Oregon |
| **Drittland** | US-Anbieter; mit EU-Region und SCC vertretbar |
| **Wichtig** | Das ist der Auftragsverarbeiter mit dem größten Datenumfang. Wenn hier etwas fehlt, hilft an keiner anderen Stelle Sorgfalt. |

## 5. Karten- und Routendienst (Mapbox oder LocationIQ)

| | |
|---|---|
| **Zweck** | Adresssuche, Routenberechnung |
| **Daten** | Abhol- und Zieladressen, Koordinaten — **ohne** Namen |
| **Abzuschließen** | DPA des gewählten Anbieters |
| **Zusätzlich** | Die kostenlosen OSM-Dienste erlauben **keine gewerbliche Nutzung**. Das ist unabhängig vom Datenschutz zu klären, sonst ist der Betrieb schlicht nicht lizenziert. |

## 6. Aviationstack (Flugdaten)

| | |
|---|---|
| **Zweck** | Verspätungserkennung bei Flughafenfahrten |
| **Daten** | **Nur Flugnummern** — kein Personenbezug |
| **Abzuschließen** | Kein AV-Vertrag nötig, solange keine personenbezogenen Daten übermittelt werden. Im Verzeichnis vermerken. |

---

## Verträge mit den Taxiunternehmen

Das ist **kein** Auftragsverarbeitungsverhältnis: das Unternehmen führt die
Beförderung in eigener Verantwortung durch und ist dafür selbst
Verantwortlicher. Zu regeln ist deshalb eine **gemeinsame oder abgegrenzte
Verantwortlichkeit** (Art. 26). In den Vertrag gehören mindestens:

1. Wer beantwortet Auskunftsersuchen von Fahrgästen — Plattform oder Unternehmen?
2. Wer informiert bei einer Datenpanne wen, und in welcher Frist?
3. Welche Daten darf das Unternehmen nach der Fahrt weiterverwenden?
   (Empfehlung: keine Direktwerbung an Fahrgäste der Plattform.)
4. Verpflichtung, Fahrer auf Vertraulichkeit zu verpflichten — insbesondere
   bei Krankenfahrten.
5. Bei angestellten Fahrern: Hinweis auf § 26 BDSG und die Mitbestimmung bei
   der Standortverfolgung. Das ist **Sache des Unternehmens**, aber die
   Plattform stellt die Technik — der Hinweis gehört in den Vertrag.

---

## Checkliste vor dem Livegang

- [ ] Stripe DPA angenommen und abgelegt
- [ ] Twilio DPA angenommen und abgelegt
- [ ] Resend DPA angefordert und abgelegt
- [ ] Render DPA abgelegt, **Region Frankfurt** bestätigt
- [ ] Kartendienst lizenziert und DPA abgelegt
- [ ] Mustervertrag für Taxiunternehmen mit Art.-26-Regelung
- [ ] Datenschutzerklärung auf der Website, die diese Empfänger benennt
- [ ] Einwilligungstext für Krankenfahrten (Art. 9) anwaltlich geprüft
