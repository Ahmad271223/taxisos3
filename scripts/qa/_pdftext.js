// Hilfsmittel: sichtbaren Text aus einem erzeugten PDF holen.
//
// Zwei Stolpersteine, die hier schon Fehlalarme erzeugt haben:
//
//  1. pdf-lib komprimiert die Inhaltsstroeme (FlateDecode) – im Rohbyte-Strom
//     steht KEIN Klartext. Erst nach dem Entpacken sind die Textoperatoren da.
//  2. pdf-lib schreibt Text als HEX-Zeichenkette `<48616C6C6F> Tj`, nicht als
//     Klammerform `(Hallo) Tj`. Wer nur Klammern sucht, findet gar nichts und
//     haelt korrekte PDFs faelschlich fuer leer.
//
// Beide Formen werden hier unterstuetzt.
/* eslint-disable no-console */
const zlib = require("zlib");

/** Alle Streams eines PDFs entpacken und aneinanderhaengen. */
function entpacken(bytes) {
  const buf = Buffer.from(bytes);
  const roh = buf.toString("latin1");
  const teile = [];
  let pos = 0;
  for (;;) {
    const s = roh.indexOf("stream", pos);
    if (s < 0) break;
    // "endstream" enthaelt selbst "stream" – ohne diese Pruefung findet die
    // Suche das Wort im ENDE des gerade gelesenen Streams wieder, verrutscht
    // und ueberspringt alle folgenden Inhalte. (Genau daran fehlten hier die
    // Seiten 2 ff. im extrahierten Text.)
    if (roh.startsWith("endstream", s - 3)) { pos = s + "stream".length; continue; }
    let von = s + "stream".length;
    if (roh[von] === "\r") von += 1;
    if (roh[von] === "\n") von += 1;
    const bis = roh.indexOf("endstream", von);
    if (bis < 0) break;
    const daten = buf.subarray(von, bis);
    try {
      teile.push(zlib.inflateSync(daten).toString("latin1"));
    } catch {
      // Nicht jeder Stream ist ein Inhaltsstrom (Schriften, Bilder) – egal.
    }
    pos = bis + "endstream".length;
  }
  return teile.join("\n");
}

/** Oktal- und Zeichen-Escapes der Klammerform aufloesen. */
function entschluesseln(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\") { out += s[i]; continue; }
    const n = s[i + 1];
    if (n === undefined) break;
    if (n >= "0" && n <= "7") {
      const okt = s.slice(i + 1, i + 4);
      out += String.fromCharCode(parseInt(okt, 8));
      i += okt.length;
    } else {
      out += n;
      i += 1;
    }
  }
  return out;
}

function hexZuText(hex) {
  const sauber = hex.replace(/[^0-9A-Fa-f]/g, "");
  let out = "";
  for (let i = 0; i + 1 < sauber.length; i += 2) {
    out += String.fromCharCode(parseInt(sauber.slice(i, i + 2), 16));
  }
  return out;
}

/** Sichtbarer Text des PDFs, eine Zeile je Textoperator. */
function pdfText(bytes) {
  const inhalt = entpacken(bytes);
  const texte = [];

  // Hexform: <...> gefolgt von Tj oder TJ (auch innerhalb eines Arrays).
  const hex = /<([0-9A-Fa-f\s]+)>\s*(?:\]\s*)?T[jJ]/g;
  let m;
  while ((m = hex.exec(inhalt))) texte.push(hexZuText(m[1]));

  // Klammerform: (...) gefolgt von Tj oder TJ.
  let pos = 0;
  for (;;) {
    const auf = inhalt.indexOf("(", pos);
    if (auf < 0) break;
    let i = auf + 1;
    let tiefe = 1;
    while (i < inhalt.length && tiefe > 0) {
      if (inhalt[i] === "\\") { i += 2; continue; }
      if (inhalt[i] === "(") tiefe += 1;
      else if (inhalt[i] === ")") tiefe -= 1;
      i += 1;
    }
    const danach = inhalt.slice(i, i + 8);
    if (/^\s*(?:\]\s*)?T[jJ]/.test(danach)) {
      texte.push(entschluesseln(inhalt.slice(auf + 1, i - 1)));
    }
    pos = i;
  }
  return texte.join("\n");
}

/**
 * Anzahl der Seiten.
 *
 * `/Type /Page` steht bei komprimierten PDFs in Objekt-Streams und ist im
 * Rohstrom nicht zaehlbar. Verlaesslicher ist die Fusszeile "Seite X von Y",
 * die unsere Abrechnungen ohnehin auf jede Seite drucken.
 */
function seitenZahl(bytes) {
  const t = pdfText(bytes);
  const m = t.match(/Seite \d+ von (\d+)/);
  if (m) return parseInt(m[1], 10);
  const roh = Buffer.from(bytes).toString("latin1");
  return (roh.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

module.exports = { pdfText, seitenZahl };
