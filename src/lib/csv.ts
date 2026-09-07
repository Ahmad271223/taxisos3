// CSV-Felder sicher schreiben.
//
// Zwei getrennte Gefahren, die oft verwechselt werden:
//
//  1. CSV-STRUKTUR: Anfuehrungszeichen, Semikolon und Zeilenumbrueche muessen
//     maskiert werden, sonst zerfaellt die Datei in falsche Spalten.
//
//  2. TABELLENKALKULATION: Excel und LibreOffice deuten ein Feld, das mit
//     = + - @ (oder Tabulator/Wagenruecklauf) beginnt, als FORMEL. Ein
//     Fahrgast, der sich "=HYPERLINK(...)" nennt, bekommt seinen Text so in
//     der Abrechnung der Zentrale ausgefuehrt. Deshalb stellen wir solchen
//     Feldern ein Apostroph voran - Excel zeigt dann den Text an und rechnet
//     nicht. Das Apostroph ist in der Zelle nicht sichtbar.
//
// Punkt 2 fehlte in allen vier Exporten (Krankenkassen-, Event-, Firmen- und
// Hotelabrechnung) - genau den Dateien, die anschliessend in Excel geoeffnet
// werden.

const FORMEL_ANFANG = /^[=+\-@\t\r]/;

/** Ein Feld fuer eine CSV-Datei aufbereiten (inkl. Anfuehrungszeichen). */
export function csvFeld(wert: unknown): string {
  let text = String(wert ?? "");
  if (FORMEL_ANFANG.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Eine ganze Zeile aus Feldern bauen (Semikolon = deutsches Excel-Format). */
export function csvZeile(felder: unknown[]): string {
  return felder.map(csvFeld).join(";");
}
