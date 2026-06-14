import { LegalLayout, H, P } from "@/components/LegalLayout";

export const metadata = { title: "Datenschutzerklärung – TaxiOS" };

export default function DatenschutzPage() {
  return (
    <LegalLayout title="Datenschutzerklärung">
      <H>1. Verantwortlicher</H>
      <P>
        Verantwortlich für die Datenverarbeitung auf dieser Plattform ist [Firmenname], [Anschrift],
        E-Mail: [E-Mail]. Einzelheiten siehe Impressum.
      </P>

      <H>2. Welche Daten wir verarbeiten</H>
      <P>
        Zur Vermittlung und Durchführung von Taxifahrten verarbeiten wir: Name und Telefonnummer des
        Fahrgastes, Abhol-, Zwischenstopp- und Zieladressen bzw. GPS-Standort, Fahrt- und
        Buchungsdetails (Zeit, Strecke, Preis), Zahlungsstatus sowie – bei Kartenzahlung – die über
        unseren Zahlungsdienstleister abgewickelten Zahlungsdaten. Für Fahrer und Unternehmen:
        Zugangs-, Fahrzeug- und Standortdaten.
      </P>

      <H>3. Zwecke und Rechtsgrundlagen</H>
      <P>
        Die Verarbeitung erfolgt zur Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) – Vermittlung,
        Disposition, Tracking, Abrechnung – sowie zur Betrugs-/Missbrauchsvermeidung und
        Telefon-Verifizierung auf Grundlage unseres berechtigten Interesses (Art. 6 Abs. 1 lit. f
        DSGVO).
      </P>

      <H>4. Empfänger / Auftragsverarbeiter</H>
      <P>
        Zur Erbringung des Dienstes setzen wir sorgfältig ausgewählte Dienstleister ein (jeweils auf
        Basis eines Auftragsverarbeitungsvertrags):
      </P>
      <P>
        • Hosting / Datenbank: [Hosting-Anbieter] (Server­standort [EU/…]).
        <br />
        • Kartenzahlung: Stripe Payments Europe, Ltd. (Zahlungsabwicklung).
        <br />
        • SMS-Verifizierung: Twilio Inc.
        <br />
        • E-Mail-Versand: Resend.
        <br />
        • Karten, Adress-Suche &amp; Routenberechnung: LocationIQ (bzw. der konfigurierte Karten­anbieter).
      </P>
      <P>
        Dabei kann es zu Übermittlungen in Drittländer (z. B. USA) kommen; diese erfolgen auf Grundlage
        geeigneter Garantien (EU-Standardvertragsklauseln / Angemessenheitsbeschluss).
      </P>

      <H>5. Speicherdauer</H>
      <P>
        Wir speichern personenbezogene Daten nur so lange, wie es für die genannten Zwecke erforderlich
        ist bzw. gesetzliche Aufbewahrungspflichten (z. B. handels- und steuerrechtlich, i. d. R. bis
        zu 10 Jahre für Rechnungen) bestehen. Verifizierungscodes werden nach kurzer Zeit gelöscht.
      </P>

      <H>6. Ihre Rechte</H>
      <P>
        Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17),
        Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21) sowie das
        Recht, eine erteilte Einwilligung zu widerrufen. Wenden Sie sich dazu an [E-Mail].
      </P>

      <H>7. Beschwerderecht</H>
      <P>
        Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, insbesondere
        in dem Mitgliedstaat Ihres Aufenthaltsorts (in [Bundesland]: [zuständige Aufsichtsbehörde]).
      </P>

      <H>8. Cookies</H>
      <P>
        Wir verwenden ausschließlich technisch notwendige Cookies (z. B. ein Login-/Session-Cookie),
        die für den Betrieb der Plattform erforderlich sind. Es findet kein Tracking zu Werbezwecken
        statt.
      </P>
    </LegalLayout>
  );
}
