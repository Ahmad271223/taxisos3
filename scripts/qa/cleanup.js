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
  const waisen = await prisma.booking.deleteMany({
    where: {
      companyId: null,
      OR: [
        { customerName: { startsWith: "QA" } },
        { customerName: { startsWith: "Track " } },
        { customerName: { startsWith: "Konto " } },
        { customerName: { startsWith: "Deckung " } },
        { customerName: { startsWith: "Race " } },
      ],
    },
  });

  const kunden = await prisma.customer.deleteMany({
    where: { OR: [{ email: { endsWith: "@test.de" } }, { email: { endsWith: "@kunde.test" } }] },
  });

  console.log(`Entfernt: ${firmen.length} Testfirmen, ${fahrer} Fahrer, ${fahrten} Fahrten,`);
  console.log(`          ${waisen.count} firmenlose Testfahrten, ${kunden.count} Testkunden.`);

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
