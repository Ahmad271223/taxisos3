// Testdaten aus der Datenbank entfernen.
//
// Warum das nötig ist: Übrig gebliebene QA-Fahrer bleiben in der Nähe des
// Standard-Abholpunkts liegen und nehmen Fahrten aus SPÄTEREN Testläufen an.
// Dadurch schlagen Tests fehl, die davon ausgehen, dass gar kein oder ein ganz
// bestimmter Fahrer verfügbar ist — der Fehler sieht dann wie ein Produktfehler
// aus, ist aber nur Verschmutzung aus einem früheren Lauf.
//
// Aufruf: node scripts/qa/cleanup.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Sicherung: dieses Skript loescht grossflaechig. Gegen eine Produktivdatenbank
// darf es niemals laufen.
if (process.env.NODE_ENV === "production") {
  console.error("Abgebrochen: cleanup.js laeuft nicht gegen den Echtbetrieb.");
  process.exit(1);
}

// Fahrten ohne Firma, die aelter als das hier sind, stammen sicher aus einem
// frueheren Lauf und nicht aus dem gerade laufenden Test.
const ALT_MINUTEN = Number(process.env.QA_CLEANUP_ALTER_MIN ?? 60);

async function main() {
  const firmen = await prisma.company.findMany({
    where: { OR: [{ name: { startsWith: "QA_" } }, { slug: { startsWith: "qa-" } }] },
    select: { id: true, slug: true },
  });
  const ids = firmen.map((f) => f.id);

  const fahrten = await prisma.booking.count({ where: { companyId: { in: ids } } });
  const fahrer = await prisma.driver.count({ where: { companyId: { in: ids } } });

  // Firmen löschen; Fahrer, Fahrten und Nachrichten hängen daran.
  if (ids.length) {
    await prisma.company.deleteMany({ where: { id: { in: ids } } });
  }

  // Verwaiste Testfahrten ohne Firma (plattformweite Buchungen aus Tests).
  //
  // Frueher stand hier eine Liste bekannter Testnamen. Die war luecken haft:
  // jede neue Reihe brachte neue Namen mit ("Flug Kunde", "Last Kunde 24",
  // "Rueck Tester" ...), und die Fahrten blieben liegen. Nach einigen Laeufen
  // standen 168 offene Vorbestellungen in der Datenbank – genug, um die auf 50
  // begrenzte Marktplatz-Liste vollstaendig zu fuellen. Eine spaetere Reihe
  // suchte darin ihre eigene Fahrt und fand sie nicht: ein Fehler, der wie ein
  // Produktfehler aussah, aber reine Verschmutzung war.
  //
  // Deshalb jetzt nach ALTER statt nach Namen: was ohne Firma dasteht und
  // aelter als ALT_MINUTEN ist, gehoert keinem laufenden Test mehr.
  const waisen = await prisma.booking.deleteMany({
    where: {
      companyId: null,
      createdAt: { lt: new Date(Date.now() - ALT_MINUTEN * 60_000) },
    },
  });

  // Zusaetzlich die frischen Fahrten der bekannten Testnamen – die duerfen
  // sofort weg, damit die naechste Reihe sauber startet.
  const frisch = await prisma.booking.deleteMany({
    where: {
      companyId: null,
      OR: [
        { customerName: { startsWith: "QA" } },
        { customerName: { startsWith: "Track " } },
        { customerName: { startsWith: "Konto " } },
        { customerName: { startsWith: "Deckung " } },
        { customerName: { startsWith: "Race " } },
        { customerName: { startsWith: "Last Kunde" } },
        { customerName: { startsWith: "Flug Kunde" } },
        { customerName: { startsWith: "Sec " } },
      ],
    },
  });

  const kunden = await prisma.customer.deleteMany({
    where: { OR: [{ email: { endsWith: "@test.de" } }, { email: { endsWith: "@kunde.test" } }] },
  });

  console.log(`Entfernt: ${firmen.length} Testfirmen, ${fahrer} Fahrer, ${fahrten} Fahrten,`);
  console.log(`          ${waisen.count + frisch.count} firmenlose Testfahrten, ${kunden.count} Testkunden.`);

  const restFahrer = await prisma.driver.count();
  const restFahrten = await prisma.booking.count();
  console.log(`Verbleibend in der Datenbank: ${restFahrer} Fahrer, ${restFahrten} Fahrten.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
