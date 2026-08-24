import { NextResponse } from "next/server";

/**
 * Die Provisions-Sammelrechnung ist stillgelegt.
 *
 * Sie rechnete ausschliesslich die Provision pro Fahrt ab. Seit die Provision
 * abgeschafft ist (Einnahmen laufen ueber das Monats-Abo), koennte sie nur noch
 * Rechnungen ueber 0,00 EUR erzeugen – und der Versand-Endpunkt haette sie sogar
 * per E-Mail an die Unternehmen geschickt. Genau das soll im Echtbetrieb nicht
 * versehentlich passieren.
 *
 * Der Rechen- und PDF-Code (lib/invoice.ts) bleibt unangetastet, falls die
 * Sammelrechnung spaeter auf die Abo-Gebuehren umgebaut werden soll. Dann
 * genuegt es, diese Sperre wieder zu entfernen.
 *
 * Zum Wiedereinschalten fuer eine Auswertung: INVOICE_MODULE=1 setzen.
 */
export function invoiceModuleRetired(): NextResponse | null {
  if (process.env.INVOICE_MODULE === "1") return null;
  return NextResponse.json(
    {
      error:
        "Die Provisions-Sammelrechnung ist stillgelegt. Auf Fahrten fällt keine Provision mehr an – " +
        "abgerechnet wird über das Monats-Abo (Stripe).",
      code: "INVOICE_MODULE_RETIRED",
      hinweis: "Abo-Rechnungen finden Sie im Stripe-Dashboard bzw. die Unternehmen unter /admin/abo.",
    },
    { status: 410 },
  );
}
