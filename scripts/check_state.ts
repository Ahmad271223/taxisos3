import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const drivers = await p.driver.findMany({ where: { active: true }, select: { id:true, name:true, status:true, vehicleClass:true }});
  console.log("DRIVERS:");
  drivers.forEach(d => console.log("  ", d.name, d.vehicleClass, d.status));
  const bookings = await p.booking.groupBy({ by:["status"], _count: { status: true }});
  console.log("BOOKINGS by status:");
  bookings.forEach(b => console.log("  ", b.status, b._count.status));
  await p.$disconnect();
})();
