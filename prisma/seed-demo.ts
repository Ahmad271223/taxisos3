import "../src/server/env";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Demo-Firma + Fahrer für die Vorschau, damit die Live-Karte etwas zeigt.
async function main() {
  const passHash = await bcrypt.hash("demo1234", 10);

  const company = await prisma.company.upsert({
    where: { slug: "citytaxi-hannover" },
    update: {},
    create: {
      name: "CityTaxi Hannover",
      slug: "citytaxi-hannover",
      email: "demo@citytaxi.test",
      passwordHash: passHash,
      pricing: {
        create: {
          basePrice: 3.9,
          perKmDay: 2.2,
          perKmNight: 2.8,
          perKmWeekend: 2.5,
          perMinute: 0.4,
          nightStartHour: 22,
          nightEndHour: 6,
        },
      },
    },
  });

  const baseLat = 52.3759;
  const baseLng = 9.732;
  const drivers = [
    { username: "murat", name: "Murat Yilmaz", plate: "H-MY 1234", model: "Mercedes E-Klasse", color: "schwarz", seats: 4, vClass: "STANDARD" },
    { username: "ahmed", name: "Ahmed Khan", plate: "H-AK 4521", model: "VW Caddy Maxi", color: "elfenbein", seats: 8, vClass: "VAN" },
    { username: "sara", name: "Sara Becker", plate: "H-SB 7788", model: "Tesla Model Y", color: "weiss", seats: 4, vClass: "BUSINESS" },
    { username: "kemal", name: "Kemal Demir", plate: "H-KD 0099", model: "Mercedes Vito", color: "elfenbein", seats: 8, vClass: "SHUTTLE" },
    { username: "lisa", name: "Lisa Hoffmann", plate: "H-LH 2233", model: "Renault Kangoo (Rollstuhl)", color: "elfenbein", seats: 4, vClass: "WHEELCHAIR" },
    { username: "tom", name: "Tom Müller", plate: "H-TM 5567", model: "Skoda Octavia", color: "elfenbein", seats: 4, vClass: "EXTRA_LUGGAGE" },
  ];

  for (let i = 0; i < drivers.length; i++) {
    const d = drivers[i];
    // Verteilte Positionen rund um Hannover Hauptbahnhof
    const angle = (i / drivers.length) * Math.PI * 2;
    const radius = 0.012 + (i % 3) * 0.005;
    const lat = baseLat + Math.cos(angle) * radius;
    const lng = baseLng + Math.sin(angle) * radius;

    await prisma.driver.upsert({
      where: { username: d.username },
      update: {
        name: d.name,
        vehicleModel: d.model,
        vehiclePlate: d.plate,
        vehicleColor: d.color,
        vehicleSeats: d.seats,
        vehicleClass: d.vClass,
        lat,
        lng,
        active: true,
        companyId: company.id,
      },
      create: {
        companyId: company.id,
        username: d.username,
        passwordHash: passHash,
        name: d.name,
        vehicleModel: d.model,
        vehiclePlate: d.plate,
        vehicleColor: d.color,
        vehicleSeats: d.seats,
        vehicleClass: d.vClass,
        lat,
        lng,
        active: true,
        status: "OFFLINE",
      },
    });
  }

  console.log(`Demo-Seed: Firma '${company.name}' + ${drivers.length} Fahrer angelegt.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
