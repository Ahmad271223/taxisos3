// Aufloesung einer Buchungs-Referenz aus der URL.
//
// SICHERHEIT: Frueher galt `OR: [trackingToken, id]` – die interne Datensatz-ID
// war damit gleichwertig mit dem hochentropischen Tracking-Token. Die ID taucht
// aber in PDF-Dateinamen, Belegnummern und API-Antworten auf. Wer sie kannte,
// konnte damit OHNE jede Anmeldung:
//   - Name, Telefon und Adressen des Fahrgasts lesen
//   - die Fahrt stornieren
//   - Ziel und Fahrpreis einer laufenden Fahrt aendern
//   - Unterschrift lesen und schreiben
//   - und ueber /pay ein frei gewaehltes Trinkgeld auf die gespeicherte Karte
//     des Fahrgasts buchen
//
// Deshalb gilt jetzt: NUR der Tracking-Token ist eine Capability. Die interne
// ID zaehlt ausschliesslich zusammen mit einer Anmeldung, die auch wirklich zu
// dieser Fahrt gehoert.

/** Gast-Zugriff: ausschliesslich ueber den Tracking-Token. */
export function bookingRefWhere(ref: string) {
  // `trackingToken` ist in der Datenbank optional. Ein leerer Verweis wuerde
  // sonst auf Datensaetze OHNE Token passen – deshalb hart ausschliessen.
  if (!ref) return { id: "__kein_treffer__" };
  return { trackingToken: ref };
}

/**
 * Zugriff eines angemeldeten Kunden: Token ODER die interne ID – letztere aber
 * nur, wenn die Fahrt diesem Kunden gehoert. Das Kundenkonto verlinkt Belege
 * ueber die ID, deshalb muss dieser Weg erhalten bleiben.
 */
export function bookingRefWhereCustomer(ref: string, customerId: string | null | undefined) {
  if (!customerId) return bookingRefWhere(ref);
  return { OR: [{ trackingToken: ref }, { id: ref, customerId }] };
}

/**
 * Zugriff aus dem Unternehmens-Dashboard: Token ODER interne ID, letztere nur
 * fuer Fahrten der eigenen Firma (Mandantentrennung).
 */
export function bookingRefWhereCompany(ref: string, companyId: string | null | undefined) {
  if (!companyId) return bookingRefWhere(ref);
  return { OR: [{ trackingToken: ref }, { id: ref, companyId }] };
}

/** Zugriff eines Fahrers: Token ODER interne ID der eigenen Fahrt. */
export function bookingRefWhereDriver(ref: string, driverId: string | null | undefined) {
  if (!driverId) return bookingRefWhere(ref);
  return { OR: [{ trackingToken: ref }, { id: ref, driverId }] };
}
