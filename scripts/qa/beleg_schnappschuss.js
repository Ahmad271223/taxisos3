// QA: Der Fahrtbeleg zeigt den Aussteller zum FAHRTZEITPUNKT.
//
// Fehlerbild ohne Schnappschuss: das Taxiunternehmen zieht um oder bekommt
// eine neue Steuernummer - und ALLE alten Belege aendern sich rueckwirkend.
// Ein erneut geladener Beleg wiche dann von dem ab, den der Fahrgast damals
// erhalten hat. Eine Rechnung muss den Aussteller zum Leistungszeitpunkt
// zeigen (§ 14 UStG), nicht den heutigen.
//
// Ablauf: Fahrt komplett fahren -> Firma "umziehen" -> Beleg neu laden ->
// es muessen die ALTEN Daten draufstehen.
//
// Aufruf: node scripts/qa/beleg_schnappschuss.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, post } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { pdfText } = require("./_pdftext");

const HBF = { lat: 52.3759, lng: 9.7320 };
const LIST = { lat: 52.3900, lng: 9.7600 };

async function main() {
  const co = await H.registerCompany("SNAP");
  await prisma.company.update({
    where: { slug: co.slug },
    data: {
      plan: "P20", subscriptionStatus: "AKTIV",
      name: "Taxi Alt GmbH", address: "Alte Strasse 1, 30159 Hannover",
      taxId: "11/111/11111", vatId: "DE111111111", phone: "0511 111111",
    },
  });
  const drv = await H.createDriver(co.admin, "S", HBF);
  const dsock = await H.goOnline(drv.cookie, HBF);
  const offers = H.collect(dsock, "driver:offer");

  section("1) Fahrt komplett durchfahren");
  const b = await post("/api/bookings", {
    company: co.slug, customerName: "Snap Test", customerPhone: "+4915100000555",
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH",
  });
  check("Fahrt gebucht", b.status === 201, b.body?.error);
  const bookingId = b.body?.id;
  const token = b.body?.booking?.trackingToken ?? bookingId;

  await H.waitFor(dsock, "driver:offer", 25000).catch(() => null);
  const ang = await H.emitAck(dsock, "driver:respond", { bookingId, accept: true });
  check("Fahrer nimmt an", ang?.ok === true, JSON.stringify(ang)?.slice(0, 80));
  for (const a of ["arrived", "start"]) {
    await H.emitAck(dsock, "driver:trip", { bookingId, action: a });
  }
  dsock.emit("driver:location", { lat: LIST.lat, lng: LIST.lng });
  await H.sleep(400);
  const fertig = await H.emitAck(dsock, "driver:trip", { bookingId, action: "complete" });
  check("Fahrt abgeschlossen", fertig?.ok === true, JSON.stringify(fertig)?.slice(0, 80));

  section("2) Schnappschuss liegt auf der Fahrt");
  const zeile = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      companyNameSnap: true, companyAddressSnap: true,
      companyTaxIdSnap: true, companyVatIdSnap: true,
    },
  });
  check("Firmenname eingefroren", zeile?.companyNameSnap === "Taxi Alt GmbH", zeile?.companyNameSnap);
  check("Anschrift eingefroren", zeile?.companyAddressSnap === "Alte Strasse 1, 30159 Hannover", zeile?.companyAddressSnap);
  check("Steuernummer eingefroren", zeile?.companyTaxIdSnap === "11/111/11111", zeile?.companyTaxIdSnap);
  check("USt-IdNr. eingefroren", zeile?.companyVatIdSnap === "DE111111111", zeile?.companyVatIdSnap);

  section("3) Firma zieht um - der alte Beleg bleibt unveraendert");
  await prisma.company.update({
    where: { slug: co.slug },
    data: {
      name: "Taxi Neu AG", address: "Neue Allee 99, 30167 Hannover",
      taxId: "99/999/99999", vatId: "DE999999999",
    },
  });
  const r = await H.raw(`/api/bookings/${token}/invoice`);
  check("Beleg laedt", r.status === 200, r.status);
  // raw() liefert { res, status, cookie } – die Bytes stecken in res.
  const text = pdfText(Buffer.from(await r.res.arrayBuffer()));
  check("ALTER Firmenname auf dem Beleg", text.includes("Taxi Alt GmbH"), text.split("\n")[1]);
  check("ALTE Anschrift auf dem Beleg", text.includes("Alte Strasse 1"));
  check("ALTE Steuernummer auf dem Beleg", text.includes("11/111/11111"));
  check("NEUER Name taucht NICHT auf", !text.includes("Taxi Neu AG"));
  check("NEUE Steuernummer taucht NICHT auf", !text.includes("99/999/99999"));
  info("Rueckfall fuer Altfahrten ohne Schnappschuss: dort gelten weiterhin die aktuellen Firmendaten.");

  await prisma.$disconnect();
  finish("BELEG-SCHNAPPSCHUSS");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e?.message ?? e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
