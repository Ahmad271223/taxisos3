// Angaben des Plattform-Betreibers (Vermittler).
//
// WICHTIG zur Abgrenzung: Die Plattform vermittelt nur. Die
// Befoerderungsleistung erbringt das jeweilige Taxiunternehmen, und der
// Fahrpreis geht zu 100 % dorthin. Diese Angaben gehoeren deshalb NICHT auf
// Fahrtbelege oder Fahrten-Abrechnungen als Aussteller, sondern
//   - in die Fusszeile ("Vermittelt ueber ...")
//   - auf die ABO-Rechnung an das Taxiunternehmen (dort ist die Plattform
//     tatsaechlich die leistende Partei)
//
// Ueber Umgebungsvariablen ueberschreibbar, damit ein Betreiberwechsel keinen
// Codeeingriff braucht.
export interface PlatformIssuer {
  name: string;
  legalName: string;
  street: string;
  zip: string;
  city: string;
  vatId: string;
  email: string;
}

export function platformIssuer(): PlatformIssuer {
  return {
    name: process.env.PLATFORM_NAME ?? "IT Solutions by Ahmad Fakih",
    legalName: process.env.PLATFORM_LEGAL_NAME ?? "Ahmad Fakih",
    street: process.env.PLATFORM_STREET ?? "Baldurstraße 5",
    zip: process.env.PLATFORM_ZIP ?? "30657",
    city: process.env.PLATFORM_CITY ?? "Hannover",
    vatId: process.env.PLATFORM_VAT_ID ?? "DE462836430",
    email: process.env.PLATFORM_EMAIL ?? "",
  };
}

/** Einzeilige Anschrift, z. B. fuer Fusszeilen. */
export function platformAddressLine(): string {
  const p = platformIssuer();
  return `${p.street} · ${p.zip} ${p.city}`;
}

/** Vollstaendige Fusszeile mit Vermittlerhinweis. */
export function platformFooter(): string {
  const p = platformIssuer();
  return `Vermittelt über ${p.name} · ${p.street}, ${p.zip} ${p.city} · USt-IdNr. ${p.vatId}`;
}
