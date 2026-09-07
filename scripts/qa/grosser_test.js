// GROSSER TEST: alle Buchungswege einmal quer durch - so, wie Fahrgaeste,
// Hotels, Veranstalter, Einrichtungen und Zentralen sie wirklich nutzen.
//
//   1. Bestaetigungscode: anfordern -> falscher Code abgelehnt -> richtiger
//      Code -> Nachweis -> Buchung mit Nachweis
//   2. Vermittlungs-Algorithmus: der NAECHSTE freie Fahrer bekommt das erste
//      Angebot, der weit entfernte nicht
//   3. "Diesen Fahrer bestellen" von der Live-Karte: NUR der gewuenschte
//      Fahrer bekommt das Angebot
//   4. Veranstalter: Promocode anlegen -> Buchung mit Code ist guenstiger,
//      falscher Code wird abgelehnt
//   5. Hotel: Fahrt fuer einen Gast (Zimmer-Abrechnung) -> vermittelt ->
//      erscheint in der Hotel-Abrechnung
//   6. Einrichtung: Krankenfahrt als Schnellauftrag -> landet bei einem
//      freigegebenen Fahrer; Krankenfahrt fuer die Zentrale -> ist fuer
//      Fahrer unsichtbar und wird von der Zentrale zugewiesen
//   7. Jede vermittelte Fahrt wird zu Ende gefahren, mit Beleg
//
// Aufruf: node scripts/qa/grosser_test.js   (Server muss laufen)
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, post, get, sleep } = H;
const { io } = require("socket.io-client");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const HBF = { lat: 52.3759, lng: 9.7320 };
const LIST = { lat: 52.3900, lng: 9.7600 };
const KROEPCKE = { lat: 52.3745, lng: 9.7380 };
// Weit weg (~4,5 km): kommt erst in der letzten Suchstufe dran.
const WEIT = { lat: 52.3350, lng: 9.7320 };

function nahe(basis, meter = 250) {
  return {
    lat: basis.lat + (Math.random() - 0.5) * (meter / 111000) * 2,
    lng: basis.lng + (Math.random() - 0.5) * (meter / 68000) * 2,
  };
}

// Fahrer verbinden und automatisch fahren lassen (annehmen -> angekommen ->
// gestartet -> beendet). Liefert Socket und die Liste der erhaltenen Angebote.
async function fahrerOnline(cookie, pos, { autoFahren = true } = {}) {
  const s = io(H.BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: cookie },
                         transports: ["polling", "websocket"], forceNew: true });
  await H.waitFor(s, "driver:state", 15000);
  const angebote = [];
  s.on("driver:offer", async (a) => {
    angebote.push(a);
    if (!autoFahren) return;
    const r = await new Promise((res) => s.emit("driver:respond", { bookingId: a.id, accept: true }, res));
    if (!r?.ok) return;
    for (const schritt of ["arrived", "start", "complete"]) {
      await sleep(250);
      await new Promise((res) => s.emit("driver:trip", { bookingId: a.id, action: schritt }, res));
    }
  });
  s.emit("driver:location", pos);
  await new Promise((r) => s.emit("driver:status", { status: "FREI" }, r));
  await sleep(300);
  return { s, angebote };
}

async function warteAufStatus(id, status, sekunden = 40) {
  for (let i = 0; i < sekunden; i++) {
    const b = await prisma.booking.findUnique({ where: { id }, select: { status: true, driverId: true } });
    if (b?.status === status) return b;
    await sleep(1000);
  }
  return await prisma.booking.findUnique({ where: { id }, select: { status: true, driverId: true } });
}

async function main() {
  const start = Date.now();
  const co = await H.registerCompany("GT");
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });
  const coId = (await prisma.company.findUnique({ where: { slug: co.slug }, select: { id: true } })).id;

  // =========================================================================
  section("1) Bestaetigungscode per SMS");
  const tel = "+4915" + String(H.uniq()).slice(-9);
  const anfrage = await post("/api/verify/request", { channel: "SMS", target: tel });
  check("Code wird angefordert", anfrage.status === 200, anfrage.body?.error);
  check("Im Testbetrieb wird der Code zurueckgegeben", !!anfrage.body?.devCode, anfrage.body);
  const falsch = await post("/api/verify/confirm", { channel: "SMS", target: tel, code: "000000" });
  check("Falscher Code wird abgelehnt", falsch.status !== 200 || !falsch.body?.token, falsch.status);
  const richtig = await post("/api/verify/confirm", { channel: "SMS", target: tel, code: anfrage.body?.devCode });
  check("Richtiger Code liefert einen Nachweis", richtig.status === 200 && !!richtig.body?.token, richtig.body?.error);
  const nachweis = richtig.body?.token;

  // =========================================================================
  section("2) Vermittlung: der naechste Fahrer bekommt das erste Angebot");
  const nah = await H.createDriver(co.admin, "Nah", nahe(HBF, 200));
  const fern = await H.createDriver(co.admin, "Fern", WEIT);
  const nahS = await fahrerOnline(nah.cookie, nah.pos);
  const fernS = await fahrerOnline(fern.cookie, fern.pos);

  const b1 = await post("/api/bookings", {
    company: co.slug, customerName: "Algo Test", customerPhone: tel,
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH", verificationToken: nachweis,
  });
  check("Buchung mit Nachweis angenommen", b1.status === 201, b1.body?.error);
  await sleep(2500);
  check("Der nahe Fahrer hat das Angebot bekommen", nahS.angebote.some((a) => a.id === b1.body?.id),
    `${nahS.angebote.length} Angebote`);
  check("Der 4,5 km entfernte Fahrer NICHT (erste Suchstufe: 500 m)", !fernS.angebote.some((a) => a.id === b1.body?.id),
    `${fernS.angebote.length} Angebote`);
  const s1 = await warteAufStatus(b1.body?.id, "ABGESCHLOSSEN");
  check("Fahrt vom nahen Fahrer zu Ende gefahren", s1?.status === "ABGESCHLOSSEN" && s1?.driverId === nah.driverId, s1);

  // =========================================================================
  section("3) 'Diesen Fahrer bestellen' von der Live-Karte");
  const wunsch = await H.createDriver(co.admin, "Wunsch", nahe(HBF, 900));
  const wunschS = await fahrerOnline(wunsch.cookie, wunsch.pos);
  nahS.angebote.length = 0;
  const b2 = await post("/api/bookings", {
    company: co.slug, customerName: "Wunsch Test", customerPhone: "+4915100000201",
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH", requestedDriverId: wunsch.driverId,
  });
  check("Buchung mit Wunschfahrer angenommen", b2.status === 201, b2.body?.error);
  await sleep(2500);
  check("Der Wunschfahrer bekommt das Angebot", wunschS.angebote.some((a) => a.id === b2.body?.id));
  check("Der eigentlich naehere Fahrer bekommt es NICHT", !nahS.angebote.some((a) => a.id === b2.body?.id));
  const s2 = await warteAufStatus(b2.body?.id, "ABGESCHLOSSEN");
  check("Fahrt vom Wunschfahrer gefahren", s2?.driverId === wunsch.driverId, s2);

  // =========================================================================
  section("4) Veranstalter: Promocode");
  const eId = H.uniq();
  const ev = await post("/api/events/register", {
    name: `Messe ${eId}`, email: `messe${eId}@test.de`.toLowerCase(), password: "Pass1234", phone: "0511999",
  });
  check("Veranstalter registriert", ev.status === 200 || ev.status === 201, ev.body?.error);
  const code = `MESSE${String(eId).slice(-4)}`;
  const promo = await post("/api/events/promos", { code, label: "Messe-Rabatt", discountType: "PERCENT", discountValue: 20 }, ev.cookie);
  check("Promocode angelegt", promo.status === 201, promo.body?.error);
  const oeffentlich = await get(`/api/promo/${code}`);
  check("Promocode ist oeffentlich pruefbar", oeffentlich.status === 200, oeffentlich.status);

  const ohne = await post("/api/quote", { from: HBF, to: LIST });
  const mitCode = await post("/api/bookings", {
    company: co.slug, customerName: "Promo Test", customerPhone: "+4915100000301",
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH", promoCode: code,
  });
  check("Buchung mit Promocode angenommen", mitCode.status === 201, mitCode.body?.error);
  const promoRow = await prisma.booking.findUnique({
    where: { id: mitCode.body?.id }, select: { promoCode: true, promoDiscount: true, priceApprox: true },
  });
  check("Promocode an der Fahrt gespeichert", promoRow?.promoCode === code, promoRow?.promoCode);
  check("Rabatt wurde berechnet (> 0)", (promoRow?.promoDiscount ?? 0) > 0, promoRow?.promoDiscount);
  // Die Fahrt speichert den Richtpreis bereits ABZUEGLICH Rabatt. Der Rabatt
  // muss also 20 % des urspruenglichen Preises (gespeichert + Rabatt) sein.
  const brutto = (promoRow?.priceApprox ?? 0) + (promoRow?.promoDiscount ?? 0);
  check("Rabatt entspricht 20 % des urspruenglichen Richtpreises",
    brutto > 0 && Math.abs((promoRow?.promoDiscount ?? 0) - brutto * 0.2) < 0.02,
    `${promoRow?.promoDiscount} vs 20% von ${brutto}`);
  check("Gespeicherter Preis ist der reduzierte", (promoRow?.priceApprox ?? 0) < brutto);
  const falscherCode = await post("/api/bookings", {
    company: co.slug, customerName: "Promo Falsch", customerPhone: "+4915100000302",
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH", promoCode: "GIBTSNICHT",
  });
  const falschRow = falscherCode.body?.id
    ? await prisma.booking.findUnique({ where: { id: falscherCode.body.id }, select: { promoDiscount: true } })
    : null;
  check("Ungueltiger Code bringt keinen Rabatt", falscherCode.status !== 201 || !(falschRow?.promoDiscount > 0),
    `${falscherCode.status} / Rabatt ${falschRow?.promoDiscount}`);
  await warteAufStatus(mitCode.body?.id, "ABGESCHLOSSEN");
  if (falscherCode.body?.id) await warteAufStatus(falscherCode.body.id, "ABGESCHLOSSEN", 30);

  // =========================================================================
  section("5) Hotel: Fahrt fuer einen Gast auf Zimmerrechnung");
  const hId = H.uniq();
  const hotel = await post("/api/hotels/register", {
    name: `Hotel Test ${hId}`, email: `hotel${hId}@test.de`.toLowerCase(), password: "Pass1234", address: "Bahnhofstr. 1",
  });
  check("Hotel registriert", hotel.status === 200 || hotel.status === 201, hotel.body?.error);
  const hFahrt = await post("/api/hotels/rides", {
    guestName: "Gast Meier", guestPhone: "+4915100000401", roomNumber: "204", hotelPayment: "ROOM",
    pickup: { address: "Hotel", ...HBF }, dest: { address: "Messe", ...LIST },
  }, hotel.cookie);
  check("Hotel-Fahrt angelegt", hFahrt.status === 201, hFahrt.body?.error);
  const s5 = await warteAufStatus(hFahrt.body?.id, "ABGESCHLOSSEN");
  check("Hotel-Fahrt vermittelt und gefahren", s5?.status === "ABGESCHLOSSEN", s5);
  const hRech = await get("/api/hotels/invoice", hotel.cookie);
  check("Hotel-Abrechnung laedt", hRech.status === 200, hRech.status);
  const inRechnung = JSON.stringify(hRech.body ?? {}).includes("Gast Meier");
  check("Gast erscheint in der Zimmer-Abrechnung", inRechnung);

  // =========================================================================
  section("6) Einrichtung: Krankenfahrten");
  const med = await H.createDriver(co.admin, "Med", nahe(HBF, 200), { medicalAllowed: true });
  const medS = await fahrerOnline(med.cookie, med.pos);
  const iId = H.uniq();
  const inst = await post("/api/institutions/register", {
    name: `Dialyse ${iId}`, type: "DIALYSE", email: `inst${iId}@test.de`.toLowerCase(), password: "Pass1234",
  });
  check("Einrichtung registriert", inst.status === 200 || inst.status === 201, inst.body?.error);
  const pat = await post("/api/institutions/patients", { name: "Erna Beispiel", birthDate: "1948-03-12", phone: "+4915100000501" }, inst.cookie);
  check("Patientin angelegt", pat.status === 201 || pat.status === 200, pat.body?.error);

  // Schnellauftrag: sofort an freie, FREIGEGEBENE Fahrer. Ohne Angabe nimmt
  // die Einrichtungs-Buchung Rollstuhltaxi als Klasse - hier gehfaehige Patientin.
  nahS.angebote.length = 0;
  const schnell = await post("/api/institutions/rides", {
    patientId: pat.body?.patient?.id, quickOrder: true,
    pickup: { address: "Heim", ...HBF }, dest: { address: "Dialyse", ...KROEPCKE }, medicalType: "DIALYSE", vehicleClass: "STANDARD",
  }, inst.cookie);
  check("Schnellauftrag angelegt", schnell.status === 201, schnell.body?.error);
  const s6 = await warteAufStatus(schnell.body?.id, "ABGESCHLOSSEN");
  check("Krankenfahrt beim FREIGEGEBENEN Fahrer gelandet", s6?.driverId === med.driverId, s6);
  check("Nicht freigegebener Fahrer bekam KEIN Angebot", !nahS.angebote.some((a) => a.id === schnell.body?.id));

  // Zentralen-Auftrag: fuer Fahrer unsichtbar, Zentrale weist zu.
  const morgen = new Date(Date.now() + 5 * 3600000).toISOString();
  const pool = await post("/api/institutions/rides", {
    patientId: pat.body?.patient?.id, scheduledAt: morgen,
    pickup: { address: "Heim", ...HBF }, dest: { address: "Dialyse", ...KROEPCKE }, medicalType: "DIALYSE", vehicleClass: "STANDARD",
  }, inst.cookie);
  check("Zentralen-Auftrag angelegt", pool.status === 201, pool.body?.error);
  const stand = await new Promise((res) => {
    const t = setTimeout(() => res(null), 8000);
    medS.s.once("driver:state", (st) => { clearTimeout(t); res(st); });
    medS.s.emit("driver:sync", {});
  });
  check("Zentralen-Auftrag ist fuer Fahrer UNSICHTBAR",
    !(stand?.openScheduled ?? []).some((o) => o.id === pool.body?.id), `${(stand?.openScheduled ?? []).length} im Marktplatz`);
  const poolListe = await get("/api/admin/medical/pool", co.admin);
  check("Zentrale sieht den Auftrag im Pool", (poolListe.body?.pool ?? []).some((p) => p.id === pool.body?.id),
    `${(poolListe.body?.pool ?? []).length} im Pool`);
  const zuweisung = await post("/api/admin/medical/pool", { bookingId: pool.body?.id, driverId: med.driverId }, co.admin);
  check("Zentrale weist den Auftrag zu", zuweisung.status === 200, zuweisung.body?.error);
  const zugewiesen = await prisma.booking.findUnique({ where: { id: pool.body?.id }, select: { driverId: true, status: true } });
  check("Auftrag haengt am zugewiesenen Fahrer", zugewiesen?.driverId === med.driverId, zugewiesen);

  // =========================================================================
  section("7) Belege fuer alle gefahrenen Fahrten");
  let belege = 0;
  const gefahren = [b1.body?.id, b2.body?.id, mitCode.body?.id, hFahrt.body?.id, schnell.body?.id].filter(Boolean);
  for (const id of gefahren) {
    const tok = (await prisma.booking.findUnique({ where: { id }, select: { trackingToken: true } }))?.trackingToken;
    const pdf = await H.raw(`/api/bookings/${tok}/invoice`);
    if (pdf.status === 200) belege++;
  }
  check(`Belege abrufbar: ${belege}/${gefahren.length}`, belege === gefahren.length);

  info(`Gesamtdauer: ${Math.round((Date.now() - start) / 1000)} s`);
  for (const x of [nahS, fernS, wunschS, medS]) x.s.close();
  await prisma.$disconnect();
  finish("GROSSER-TEST");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e?.message ?? e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
