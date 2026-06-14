import { LegalLayout, H, P } from "@/components/LegalLayout";

export const metadata = { title: "AGB – TaxiOS" };

export default function AgbPage() {
  return (
    <LegalLayout title="Allgemeine Geschäftsbedingungen">
      <H>§ 1 Geltungsbereich</H>
      <P>
        Diese AGB gelten für die Nutzung der Vermittlungsplattform [Firmenname] („Plattform") durch
        Fahrgäste, Taxiunternehmen und Fahrer.
      </P>

      <H>§ 2 Gegenstand der Leistung (Vermittlung)</H>
      <P>
        Die Plattform vermittelt Beförderungswünsche an angeschlossene, konzessionierte
        Taxiunternehmen. Der Beförderungsvertrag kommt ausschließlich zwischen dem Fahrgast und dem
        ausführenden Taxiunternehmen zustande; die Plattform wird nicht selbst Beförderer.
      </P>

      <H>§ 3 Buchung und Preise</H>
      <P>
        Vor der Zuweisung eines Fahrers wird ein unverbindlicher Circa-Preis auf Basis eines täglich
        ermittelten Plattform-Durchschnitts angezeigt („ca."). Nach Zuweisung eines Fahrers gilt der
        anhand des Tarifs des ausführenden Unternehmens berechnete Festpreis, der angezeigt wird.
        Maßgeblich für die Abrechnung ist dieser Festpreis bzw. der tatsächlich gefahrene Tarif gemäß
        geltendem Recht.
      </P>

      <H>§ 4 Zahlung</H>
      <P>
        Die Zahlung erfolgt wahlweise bar beim Fahrer oder per Karte. Bei Kartenzahlung wird bei
        Bestellung ein Betrag in Höhe der oberen Preisschätzung autorisiert (reserviert); die
        tatsächliche Belastung erfolgt nach Fahrtende in Höhe des Fahrpreises. Die Zahlungsabwicklung
        erfolgt über unseren Zahlungsdienstleister.
      </P>

      <H>§ 5 Stornierung</H>
      <P>
        Fahrten können bis zum Eintreffen des Fahrers am Abholort kostenfrei storniert werden. Eine
        autorisierte Kartenzahlung wird bei Stornierung freigegeben. [Etwaige Stornogebühren/Regelungen
        hier ergänzen.]
      </P>

      <H>§ 6 Pflichten der Nutzer</H>
      <P>
        Fahrgäste machen wahrheitsgemäße Angaben (insbesondere eine erreichbare, verifizierte
        Telefonnummer). Eine missbräuchliche Nutzung (z. B. Scheinbuchungen) ist untersagt.
      </P>

      <H>§ 7 Haftung</H>
      <P>
        Für die Beförderung haftet das ausführende Taxiunternehmen. Die Plattform haftet im Rahmen der
        Vermittlung nach den gesetzlichen Bestimmungen; eine Haftung für leichte Fahrlässigkeit ist –
        außer bei Verletzung wesentlicher Vertragspflichten sowie bei Schäden aus der Verletzung des
        Lebens, des Körpers oder der Gesundheit – ausgeschlossen. [Von Anwalt prüfen lassen.]
      </P>

      <H>§ 8 Schlussbestimmungen</H>
      <P>
        Es gilt das Recht der Bundesrepublik Deutschland. Sollte eine Bestimmung unwirksam sein, bleibt
        die Wirksamkeit der übrigen Bestimmungen unberührt. Stand: [Datum].
      </P>
    </LegalLayout>
  );
}
