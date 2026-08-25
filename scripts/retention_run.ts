// Loeschlauf von Hand ausloesen – vor allem fuer den Trockenlauf.
//
//   RETENTION_TROCKEN=1 npx tsx scripts/retention_run.ts   (zeigt nur an)
//   npx tsx scripts/retention_run.ts                       (loescht wirklich)
import { retentionLauf, berichtAusgeben } from "../src/server/retention";
import { prisma } from "../src/lib/prisma";

(async () => {
  const trocken = process.env.RETENTION_TROCKEN === "1";
  if (!trocken) {
    console.log("ACHTUNG: echter Lauf. Fuer eine Vorschau RETENTION_TROCKEN=1 setzen.");
  }
  const bericht = await retentionLauf(trocken);
  berichtAusgeben(bericht);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error("Loeschlauf fehlgeschlagen:", e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
