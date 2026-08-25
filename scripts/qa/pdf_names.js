// QA: Namen auf Belegen und Abrechnungen müssen lesbar bleiben.
//
// Die eingebettete Standardschrift kann nur Latin-1. Vorher ersetzte `safe()`
// jedes andere Zeichen durch "?" – auf dem Fahrgast-Beleg stand dann
// "?ahin, Ay?e" statt "Sahin, Ayse", in der Einrichtungs-Abrechnung
// "Nowakovi?, Milo?". Türkische, polnische und Balkan-Namen sind im deutschen
// Taxi- und Pflegemarkt Alltag; ein Beleg mit Fragezeichen im Namen ist
// unbrauchbar (und für die Buchhaltung des Fahrgasts wertlos).
//
// Aufruf: node scripts/qa/pdf_names.js
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const H = require("./helpers");
const { check, info, section, finish } = H;

const ROOT = path.resolve(__dirname, "../..");

// Den ECHTEN Produktionscode prüfen, nicht eine Kopie davon.
function ladeSafe() {
  const quelle = fs.readFileSync(path.join(ROOT, "src/lib/pdf.ts"), "utf8");
  const von = quelle.indexOf("const UMSCHRIFT");
  const bis = quelle.indexOf("function eur");
  if (von < 0 || bis < 0) throw new Error("safe() nicht gefunden – wurde pdf.ts umgebaut?");
  const js = quelle.slice(von, bis).replace(/: Record<string, string>/g, "").replace(/: string/g, "");
  // eslint-disable-next-line no-eval
  return eval(`(() => { ${js} return safe; })()`);
}

function main() {
  const safe = ladeSafe();

  section("1) Namen aus dem deutschen Markt bleiben lesbar");
  const namen = [
    ["Şahin, Ayşe", "Sahin, Ayse", "türkisch"],
    ["Ünal, İbrahim", "Ünal, Ibrahim", "türkisch mit Umlaut"],
    ["Łukasz Wiśniewski", "Lukasz Wisniewski", "polnisch"],
    ["Nowaković, Miloš", "Nowakovic, Milos", "Balkan"],
    ["Đorđević, Nenad", "Dordevic, Nenad", "serbisch"],
    ["Horváth, Károly", "Horváth, Károly", "ungarisch (Latin-1)"],
  ];
  for (const [ein, erwartet, herkunft] of namen) {
    const ist = safe(ein);
    check(`${herkunft.padEnd(22)} ${ein}`, ist === erwartet, `-> ${ist}`);
  }

  section("2) Deutsche Umlaute bleiben unverändert");
  for (const n of ["Müller, Jörg", "Straße 5", "Käthe Weiß", "Öhringen"]) {
    check(`${n} bleibt erhalten`, safe(n) === n, safe(n));
  }

  section("3) Keine Fragezeichen mehr in der Ausgabe");
  const alle = namen.map(([e]) => e).join(" ") + " Müller Straße";
  check("Kein '?' im Ergebnis", !safe(alle).includes("?"), safe(alle));

  section("4) Typografie wird sinnvoll ersetzt");
  const typo = [
    ["Straße 5 → Klinik", "Straße 5 -> Klinik", "Pfeil"],
    ["„Zitat“", '"Zitat"', "Anführungszeichen"],
    ["12–15 Uhr", "12-15 Uhr", "Gedankenstrich"],
    ["5 €", "5 EUR", "Euro-Zeichen"],
  ];
  for (const [ein, erwartet, was] of typo) {
    check(`${was.padEnd(20)} ${ein}`, safe(ein) === erwartet, `-> ${safe(ein)}`);
  }

  section("5) Unbekannte Zeichen verschwinden, statt '?' zu hinterlassen");
  check("Emoji wird weggelassen", safe("Fahrt 🚕 Hannover") === "Fahrt  Hannover", safe("Fahrt 🚕 Hannover"));
  check("Kyrillisch wird weggelassen statt '?'", !safe("Иванов").includes("?"), safe("Иванов"));
  info("Sauberer wäre eine eingebettete Unicode-Schrift (fontkit) – bis dahin ist Umschrift das Richtige.");

  finish("PDF-NAMEN");
}

main();
