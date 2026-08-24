import "../src/server/env"; // .env laden, bevor PrismaClient initialisiert wird
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Produktions-Seed: KEINE Demo-Unternehmen, KEINE Demo-Fahrer.
 *
 * Es werden lediglich notwendige System-Konten angelegt:
 *  - Ein Super-Admin-Konto, falls in der .env hinterlegt
 *    (SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD). Es wird als
 *    Company-Eintrag mit slug "_super" hinterlegt, damit Login &
 *    Multi-Mandanten-Auswertung sauber funktionieren.
 *
 * Echte Taxiunternehmen registrieren sich selbst ueber /registrieren.
 */
async function main() {
  console.log("Seed: System-Vorbereitung …");

  const superEmail = (process.env.SUPER_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const superPass = process.env.SUPER_ADMIN_PASSWORD ?? "";

  if (superEmail && superPass) {
    const passHash = await bcrypt.hash(superPass, 10);
    await prisma.company.upsert({
      where: { slug: "_super" },
      update: {
        email: superEmail,
        passwordHash: passHash,
      },
      create: {
        name: "TaxiOS Super-Admin",
        slug: "_super",
        email: superEmail,
        passwordHash: passHash,
        pricing: {
          create: {
            basePrice: 4.0,
            perKmDay: 2.5,
            perKmNight: 3.2,
            perKmWeekend: 2.8,
            perMinute: 0.0,
            nightStartHour: 22,
            nightEndHour: 6,
          },
        },
      },
    });
    console.log(`  Super-Admin angelegt: ${superEmail}`);
  } else {
    console.log("  (Kein Super-Admin – SUPER_ADMIN_EMAIL/PASSWORD nicht gesetzt)");
  }

  // Aufraeumen: alte Demo-Daten entfernen, damit nichts „mock“ bleibt.
  //
  // ACHTUNG: hier stand frueher nur "citytaxi"; seed-demo.ts legt die Firma
  // aber unter "citytaxi-hannover" an. Die Aufraeumroutine traf die Demo-Daten
  // also NIE – Firma und Fahrer blieben mit dem dokumentierten Passwort
  // "demo1234" bestehen.
  for (const slug of ["citytaxi", "citytaxi-hannover"]) {
    const demo = await prisma.company.findUnique({ where: { slug } });
    if (demo) {
      await prisma.company.delete({ where: { id: demo.id } });
      console.log(`  Demo-Firma '${slug}' und alle zugehoerigen Fahrer/Buchungen entfernt.`);
    }
  }

  console.log("Seed abgeschlossen. Echte Unternehmen registrieren sich unter /registrieren.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
