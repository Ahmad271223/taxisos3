import { LegalLayout, H, P } from "@/components/LegalLayout";

export const metadata = { title: "Impressum – TaxiOS" };

export default function ImpressumPage() {
  return (
    <LegalLayout title="Impressum">
      <H>Angaben gemäß § 5 DDG (ehem. § 5 TMG)</H>
      <P>
        [Firmenname / Betreibergesellschaft]
        <br />
        [Straße und Hausnummer]
        <br />
        [PLZ und Ort]
      </P>

      <H>Vertreten durch</H>
      <P>[Name der vertretungsberechtigten Person(en), z. B. Geschäftsführer]</P>

      <H>Kontakt</H>
      <P>
        Telefon: [Telefonnummer]
        <br />
        E-Mail: [E-Mail-Adresse]
      </P>

      <H>Registereintrag</H>
      <P>
        Eintragung im Handelsregister.
        <br />
        Registergericht: [Amtsgericht]
        <br />
        Registernummer: [HRB …]
      </P>

      <H>Umsatzsteuer-ID</H>
      <P>Umsatzsteuer-Identifikationsnummer gemäß § 27 a UStG: [DE…]</P>

      <H>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</H>
      <P>
        [Name]
        <br />
        [Anschrift wie oben]
      </P>

      <H>EU-Streitschlichtung</H>
      <P>
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{" "}
        <a className="font-semibold text-ink-900 underline" href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noreferrer">
          https://ec.europa.eu/consumers/odr/
        </a>
        . Unsere E-Mail-Adresse finden Sie oben. Wir sind nicht bereit oder verpflichtet, an
        Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
      </P>
    </LegalLayout>
  );
}
