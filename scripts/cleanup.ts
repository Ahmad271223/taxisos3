import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  // Hängende ZUGEWIESEN/AKTIV Buchungen → OFFEN/STORNIERT (Test-Daten)
  const cancelled = await p.booking.updateMany({
    where: { status: { in: ["ZUGEWIESEN", "AKTIV"] } },
    data: { status: "STORNIERT", trackingStatus: "STORNIERT", driverId: null, isReserved: false },
  });
  // Alle Test-Buchungen, die OFFEN/Search hängen, schließen
  const cleared = await p.booking.updateMany({
    where: { status: "OFFEN" },
    data: { status: "STORNIERT", trackingStatus: "STORNIERT" },
  });
  // Alle Fahrer auf FREI
  const drivers = await p.driver.updateMany({
    where: { status: { not: "OFFLINE" } },
    data: { status: "FREI" },
  });
  console.log("Cancelled:", cancelled.count, "Cleared:", cleared.count, "DriversReset:", drivers.count);
}
main().finally(() => p.$disconnect());
