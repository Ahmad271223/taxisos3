import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

(async () => {
  // Pick the OFFEN booking by anna (most recent), set assignedAt 10min ago, status ZUGEWIESEN, trackingStatus FAHRER_UNTERWEGS, attach murat
  const murat = await p.driver.findFirst({ where: { username: "murat" } });
  if (!murat) {
    console.log("Murat not found");
    process.exit(1);
  }
  // Find a recent OFFEN booking, or use an old completed one as a test
  const customer = await p.customer.findFirst({ where: { email: "anna@kunde.test" } });
  if (!customer) {
    console.log("anna not found");
    process.exit(1);
  }
  // Create a synthetic ZUGEWIESEN booking that's stuck
  const past = new Date(Date.now() - 10 * 60_000); // 10 min ago
  const b = await p.booking.create({
    data: {
      customerName: "TEST_STUCK",
      customerPhone: "+491700000000",
      customerId: customer.id,
      pickupAddress: "Hauptbahnhof",
      pickupLat: 52.3759,
      pickupLng: 9.7320,
      destAddress: "Marktplatz",
      destLat: 52.3669,
      destLng: 9.7510,
      status: "ZUGEWIESEN",
      trackingStatus: "FAHRER_UNTERWEGS",
      driverId: murat.id,
      assignedAt: past,
      vehicleClass: "STANDARD",
      paymentMethod: "CASH",
    } as any,
  });
  await p.driver.update({ where: { id: murat.id }, data: { status: "RESERVIERT" } });
  console.log("Stuck booking created:", b.id, "assignedAt:", past.toISOString());
  console.log("Murat status set to RESERVIERT");

  // Wait up to 60s for the watchdog (runs every 20s) to reset it
  let resolved = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const bb = await p.booking.findUnique({ where: { id: b.id } });
    const dd = await p.driver.findUnique({ where: { id: murat.id } });
    if (bb && bb.status === "OFFEN" && bb.driverId === null && dd?.status === "FREI") {
      console.log(`✓ Watchdog reset after ${(i + 1) * 2.5}s. booking.status=${bb.status} driverId=${bb.driverId}, murat=${dd.status}`);
      resolved = true;
      break;
    }
    if (i % 4 === 0) console.log(`  ...t=${(i + 1) * 2.5}s booking=${bb?.status}/${bb?.trackingStatus}/${bb?.driverId} murat=${dd?.status}`);
  }
  if (!resolved) {
    const bb = await p.booking.findUnique({ where: { id: b.id } });
    const dd = await p.driver.findUnique({ where: { id: murat.id } });
    console.log("✗ Watchdog FAILED to reset. booking:", bb?.status, bb?.driverId, "murat:", dd?.status);
  }
  // cleanup
  await p.booking.delete({ where: { id: b.id } }).catch(() => {});
  await p.driver.update({ where: { id: murat.id }, data: { status: "FREI" } }).catch(() => {});
  await p.$disconnect();
  process.exit(resolved ? 0 : 2);
})();
