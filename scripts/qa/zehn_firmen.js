// QA-GROSSSZENARIO: 10 registrierte Firmen mit je 5-10 Fahrern.
//
// Das ist die "klappt wirklich alles?"-Probe vor dem Livegang: nicht eine
// Funktion isoliert, sondern der volle Marktplatz auf einmal -
//
//   - 10 Firmen (5x Tarif P5 mit 5 Fahrern, 5x P10 mit 10 Fahrern = 75 Fahrer)
//   - Fahrer mit Krankenfahrt-Freigabe und Rollstuhlrampe verteilt
//   - Sofortfahrten von Gaesten UND angemeldeten Kunden, quer ueber die Firmen
//   - Krankenfahrt (Dialyse) -> darf NUR bei freigegebenen Fahrern landen
//   - Rollstuhlfahrt -> darf NUR bei Fahrern mit Rampe landen
//   - Vorbestellung -> erscheint im Marktplatz, ein Fahrer reserviert sie
//   - jede Fahrt wird zu Ende gefahren: angekommen -> gestartet -> beendet,
//     Beleg abrufbar
//   - Mandantentrennung: Firma 1 sieht nur die eigenen Fahrten
//
// Aufruf: node scripts/qa/zehn_firmen.js   (Server muss laufen)
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, post, get, sleep } = H;
const { io } = require("socket.io-client");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const HBF = { lat: 52.3759, lng: 9.7320 };
const LIST = { lat: 52.3900, lng: 9.7600 };

// Fahrer eng um den Abholpunkt streuen (Phase 0/1 der Vermittlung: 500 m-1 km),
// damit Angebote schnell kommen und der Test nicht an Geduld scheitert.
function nahe(basis, meter = 400) {
  const dLat = (Math.random() - 0.5) * (meter / 111000) * 2;
  const dLng = (Math.random() - 0.5) * (meter / 68000) * 2;
  return { lat: basis.lat + dLat, lng: basis.lng + dLng };
}

async function main() {
  const start = Date.now();

  // =========================================================================
  section("1) Zehn Firmen registrieren (5x P5, 5x P10)");
  const firmen = [];
  for (let i = 0; i < 10; i++) {
    const co = await H.registerCompany(`ZF${i}`);
    if (co.status !== 201 && co.status !== 200) { info(`Firma ${i}: ${co.status} ${co.body?.error ?? ""}`); continue; }
    const plan = i < 5 ? "P5" : "P10";
    await prisma.company.update({ where: { slug: co.slug }, data: { plan, subscriptionStatus: "AKTIV" } });
    firmen.push({ ...co, plan, sollFahrer: i < 5 ? 5 : 10 });
  }
  check("10 Firmen registriert und aktiv", firmen.length === 10, firmen.length);

  // =========================================================================
  section("2) 75 Fahrer anlegen (je Firma 1x Krankenfahrt, grosse auch Rampe)");
  const fahrer = [];
  for (const [fi, co] of firmen.entries()) {
    for (let d = 0; d < co.sollFahrer; d++) {
      // Fahrer 0 jeder Firma: Krankenfahrten-Freigabe.
      // Fahrer 1 der P10-Firmen: Freigabe UND Rollstuhlrampe.
      const extra =
        d === 0 ? { medicalAllowed: true }
        : d === 1 && co.sollFahrer === 10 ? { medicalAllowed: true, hasRamp: true }
        : {};
      const f = await H.createDriver(co.admin, `Z${fi}x${d}`, nahe(HBF), extra);
      if (!f.cookie) { info(`Fahrer ${fi}/${d} abgelehnt: ${f.created?.status} ${f.created?.body?.error ?? ""}`); continue; }
      fahrer.push({ ...f, co, medical: !!extra.medicalAllowed, rampe: !!extra.hasRamp });
    }
  }
  check("75 Fahrer angelegt (Tarifgrenzen eingehalten)", fahrer.length === 75, fahrer.length);
  const zuViel = await post("/api/admin/drivers",
    { name: "Nr. 6", username: `zuviel${H.uniq()}`, password: "Pass1234" }, firmen[0].admin);
  check("Der 6. Fahrer einer P5-Firma wird abgelehnt", zuViel.status === 402, zuViel.status);

  // =========================================================================
  section("3) Alle 75 gleichzeitig online");
  const ergebnis = await Promise.all(fahrer.map((f) => new Promise((res) => {
    const s = io(H.BASE, { auth: { role: "driver" }, extraHeaders: { Cookie: f.cookie },
                           transports: ["polling", "websocket"], forceNew: true });
    const t = setTimeout(() => res({ ok: false, s }), 25000);
    s.once("driver:state", () => { clearTimeout(t); res({ ok: true, s }); });
  })));
  const sockets = ergebnis.map((r) => r.s);
  check("Alle Fahrer bekommen ihren Auftragsstand", ergebnis.every((r) => r.ok),
    `${ergebnis.filter((r) => r.ok).length}/${fahrer.length}`);

  await Promise.all(sockets.map((s, i) => {
    s.emit("driver:location", fahrer[i].pos);
    return new Promise((r) => s.emit("driver:status", { status: "FREI" }, r));
  }));
  await sleep(1500);

  // Automatik: jeder Fahrer nimmt eingehende Angebote an und faehrt die Fahrt
  // vollstaendig zu Ende - wie im echten Betrieb.
  const uebernommen = new Map(); // bookingId -> fahrerIdx
  sockets.forEach((s, i) => {
    s.on("driver:offer", async (a) => {
      const r = await new Promise((res) => s.emit("driver:respond", { bookingId: a.id, accept: true }, res));
      if (!r?.ok) return; // jemand anders war schneller
      uebernommen.set(a.id, i);
      for (const schritt of ["arrived", "start", "complete"]) {
        await sleep(250);
        await new Promise((res) => s.emit("driver:trip", { bookingId: a.id, action: schritt }, res));
      }
    });
  });

  // =========================================================================
  section("4) 12 Sofortfahrten: Gaeste und Kunden, quer ueber die Firmen");
  const kunde = await post("/api/customer/register", {
    name: "Gross Kunde", email: `gross${H.uniq()}@test.de`,
    phone: "+4915" + String(H.uniq()).slice(-9), password: "Pass1234",
  });
  check("Kundenkonto angelegt", kunde.status === 200 || kunde.status === 201, kunde.status);

  const buchungen = [];
  for (let i = 0; i < 12; i++) {
    const co = firmen[i % 10];
    const alsKunde = i % 3 === 0; // jede dritte mit Konto, Rest als Gast
    const r = await post("/api/bookings", {
      company: co.slug,
      customerName: alsKunde ? "Gross Kunde" : `Gast ${i}`,
      customerPhone: "+49151" + String(7000000 + i),
      pickupAddress: `Testabholung ${i}`, pickup: nahe(HBF, 150),
      destAddress: "List", dest: LIST,
      paymentMethod: "CASH",
    }, alsKunde ? kunde.cookie : undefined);
    buchungen.push({ id: r.body?.id, status: r.status, co });
  }
  check("Alle 12 Bestellungen angenommen", buchungen.every((b) => b.status === 201),
    buchungen.map((b) => b.status).join(","));

  // =========================================================================
  section("5) Krankenfahrt und Rollstuhlfahrt");
  const kranken = await post("/api/bookings", {
    company: firmen[7].slug,
    customerName: "Klinik Fall", customerPhone: "+4915170000101",
    pickupAddress: "Seniorenheim", pickup: nahe(HBF, 150),
    destAddress: "Dialysezentrum", dest: LIST,
    paymentMethod: "CASH",
    medicalType: "DIALYSE", patientName: "Erna Beispiel",
  });
  check("Krankenfahrt gebucht", kranken.status === 201, kranken.body?.error);

  const rollstuhl = await post("/api/bookings", {
    customerName: "Rolli Fall", customerPhone: "+4915170000102",
    pickupAddress: "Wohnung", pickup: nahe(HBF, 150),
    destAddress: "Arztpraxis", dest: LIST,
    paymentMethod: "CASH",
    medicalType: "ARZT", requiresRamp: true,
  });
  check("Rollstuhlfahrt gebucht", rollstuhl.status === 201, rollstuhl.body?.error);

  // =========================================================================
  section("6) Warten, bis ALLE Fahrten zu Ende gefahren sind");
  const alleIds = [...buchungen.map((b) => b.id), kranken.body?.id, rollstuhl.body?.id].filter(Boolean);
  let fertig = 0;
  for (let runde = 0; runde < 40; runde++) {
    fertig = await prisma.booking.count({ where: { id: { in: alleIds }, status: "ABGESCHLOSSEN" } });
    if (fertig === alleIds.length) break;
    await sleep(2000);
  }
  check(`Alle ${alleIds.length} Fahrten abgeschlossen`, fertig === alleIds.length, `${fertig}/${alleIds.length}`);

  const rows = await prisma.booking.findMany({
    where: { id: { in: alleIds } },
    select: { id: true, status: true, fare: true, driverId: true, companyId: true,
              driverNameSnap: true, driverPlateSnap: true,
              driver: { select: { medicalAllowed: true, hasRamp: true, companyId: true } } },
  });
  check("Jede Fahrt hat einen Fahrer", rows.every((r) => r.driverId),
    rows.filter((r) => !r.driverId).length + " ohne");
  check("Jede Fahrt hat einen Fahrpreis", rows.every((r) => (r.fare ?? 0) > 0),
    rows.filter((r) => !((r.fare ?? 0) > 0)).map((r) => r.id).join(","));
  check("Jede Fahrt traegt Namens- und Kennzeichen-Schnappschuss",
    rows.every((r) => r.driverNameSnap && r.driverPlateSnap));

  const kr = rows.find((r) => r.id === kranken.body?.id);
  check("Krankenfahrt lief bei einem FREIGEGEBENEN Fahrer", kr?.driver?.medicalAllowed === true,
    JSON.stringify({ medical: kr?.driver?.medicalAllowed }));
  const rs = rows.find((r) => r.id === rollstuhl.body?.id);
  check("Rollstuhlfahrt lief bei einem Fahrer MIT RAMPE", rs?.driver?.hasRamp === true,
    JSON.stringify({ rampe: rs?.driver?.hasRamp }));

  const beteiligteFirmen = new Set(rows.map((r) => r.driver?.companyId).filter(Boolean));
  info(`${beteiligteFirmen.size} verschiedene Firmen haben Fahrten uebernommen`);
  check("Mehrere Firmen am Marktplatz beteiligt", beteiligteFirmen.size >= 3, beteiligteFirmen.size);

  // =========================================================================
  section("7) Beleg je Fahrt abrufbar");
  let belege = 0;
  for (const b of rows.slice(0, 5)) {
    const token = (await prisma.booking.findUnique({
      where: { id: b.id }, select: { trackingToken: true },
    }))?.trackingToken;
    const pdf = await H.raw(`/api/bookings/${token}/invoice`);
    if (pdf.status === 200) belege++;
  }
  check("Stichprobe: 5 von 5 Belegen abrufbar", belege === 5, `${belege}/5`);

  // =========================================================================
  section("8) Vorbestellung: Marktplatz und Reservierung");
  const morgen = new Date(Date.now() + 6 * 3600000).toISOString();
  const vorb = await post("/api/bookings", {
    company: firmen[2].slug, customerName: "Vorbestellung", customerPhone: "+4915170000103",
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH", scheduledAt: morgen,
  });
  check("Vorbestellung angelegt", vorb.status === 201, vorb.body?.error);
  await sleep(1200);

  // Ein Fahrer laedt seinen Stand neu und muss sie im Marktplatz sehen.
  const belegteIdx = new Set(uebernommen.values());
  const freiIdx = sockets.findIndex((_, i) => !belegteIdx.has(i));
  const sFrei = sockets[freiIdx >= 0 ? freiIdx : 0];
  const standNeu = await new Promise((res) => {
    const t = setTimeout(() => res(null), 10000);
    sFrei.once("driver:state", (st) => { clearTimeout(t); res(st); });
    sFrei.emit("driver:sync", {});
  });
  const imMarkt = (standNeu?.openScheduled ?? []).some((o) => o.id === vorb.body?.id);
  check("Vorbestellung erscheint im Fahrer-Marktplatz", imMarkt,
    `${(standNeu?.openScheduled ?? []).length} Eintraege`);
  const reserviert = await new Promise((r) => sFrei.emit("driver:reserve", { bookingId: vorb.body?.id }, r));
  check("Ein Fahrer reserviert die Vorbestellung", reserviert?.ok === true,
    JSON.stringify(reserviert)?.slice(0, 80));

  // =========================================================================
  section("9) Mandantentrennung unter Last");
  // Die Zentrale bekommt ihre Fahrten ueber den Socket-Schnappschuss.
  const f0 = await prisma.company.findUnique({ where: { slug: firmen[0].slug }, select: { id: true } });
  const adminSock = H.connectSocket(firmen[0].admin, "admin");
  const schnappschuss = await H.waitFor(adminSock, "admin:snapshot", 15000).catch(() => null);
  adminSock.close();
  check("Firmen-Dashboard laedt unter Last", !!schnappschuss, schnappschuss ? "ok" : "kein Schnappschuss");
  const fremde = (schnappschuss?.bookings ?? []).filter((b) => b.companyId && b.companyId !== f0.id);
  check("Firma 1 sieht KEINE fremden Fahrten", fremde.length === 0, `${fremde.length} fremde`);
  const eigeneFahrer = (schnappschuss?.drivers ?? []).length;
  check("Firma 1 sieht genau ihre 5 Fahrer", eigeneFahrer === 5, eigeneFahrer);

  info(`Gesamtdauer: ${Math.round((Date.now() - start) / 1000)} s`);
  sockets.forEach((s) => s.close());
  await prisma.$disconnect();
  finish("ZEHN-FIRMEN-SZENARIO");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e?.message ?? e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
