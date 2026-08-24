// HINWEIS: Dieser Test prueft das FRUEHERE Zahlungsmodell
// (Karten-Hold beim Buchen + Capture bei Fahrtende). Dieses Modell wurde
// abgeloest: Karten werden jetzt im Kundenkonto gespeichert und ERST NACH
// Fahrtende belastet (kein Hold mehr, kein blockiertes Geld bei Vorbestellungen).
//
// Der vollstaendige neue Zahlungsablauf wird geprueft in:
//     node scripts/qa/payment_flow.js
//
/* eslint-disable no-console */
console.log("Dieser Test ist ersetzt durch: scripts/qa/payment_flow.js");
console.log("Das Hold-Modell (authorize-then-capture) wird nicht mehr verwendet.");
process.exit(0);
