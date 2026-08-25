// QA: Zugriffsschutz auf Fahrten, Rate-Limit und Mandantentrennung.
//
// Hintergrund der einzelnen Punkte:
//
// A) Die interne Buchungs-ID war einer Anmeldung gleichwertig. Sie taucht in
//    PDF-Dateinamen und API-Antworten auf – wer sie kannte, konnte ohne Konto
//    fremde Fahrten lesen, stornieren, das Ziel ändern und über /pay ein
//    Trinkgeld auf die gespeicherte Karte des Fahrgasts buchen.
//
// B) Das Rate-Limit las das ERSTE Element von x-forwarded-for. Das stammt vom
//    Aufrufer selbst. Mit "127.0.0.1" fiel der Schutz komplett weg.
//
// C) Das DSGVO-Zugriffsprotokoll hatte keine Mandantenspalte – jeder
//    Firmen-Admin las die Zugriffe aller Unternehmen auf Gesundheitsdaten.
//
// Aufruf: node scripts/qa/security_refs.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep, api, get, post, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");

async function kundeAnlegen(tag) {
  const id = H.uniq();
  const mail = `sec${tag}${id}@test.de`.toLowerCase();
  const tel = "+4915" + String(id).slice(-9);
  const r = await post("/api/customer/register", { name: `Sec ${tag}`, email: mail, phone: tel, password: "Pass1234" });
  return { cookie: r.cookie, mail, tel, name: `Sec ${tag}` };
}

async function main() {
  const co = await H.registerCompany("SEC");
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });

  const kunde = await kundeAnlegen("A");
  const fremder = await kundeAnlegen("B");

  const b = await post("/api/bookings", {
    company: co.slug, customerName: kunde.name, customerPhone: kunde.tel,
    pickupAddress: "Hauptbahnhof", pickup: HBF, destAddress: "List", dest: LIST,
    paymentMethod: "CASH",
  }, kunde.cookie);
  check("Fahrt angelegt", b.status === 201, b.body?.error);
  const id = b.body?.id;
  // Die Buchungsantwort enthaelt den Token nicht auf oberster Ebene.
  const gespeichert = await prisma.booking.findUnique({ where: { id }, select: { trackingToken: true } });
  const token = gespeichert?.trackingToken;
  check("Fahrt hat einen Tracking-Token", !!token && token !== id, token ? "vorhanden" : "FEHLT");

  // =========================================================================
  section("A1) Ohne Anmeldung öffnet die interne ID nichts mehr");
  const wege = [
    ["GET", "", "Fahrtdaten lesen"],
    ["GET", "/invoice", "Beleg herunterladen"],
    ["POST", "/cancel", "Fahrt stornieren"],
    ["POST", "/destination", "Ziel ändern"],
    ["POST", "/rating", "Bewerten", { rating: 5 }],
    ["POST", "/signature", "Unterschrift setzen"],
    ["GET", "/signature", "Unterschrift lesen"],
    ["POST", "/pay", "ZAHLUNG auslösen"],
  ];
  for (const [methode, sub, name, koerper] of wege) {
    const r = await api(`/api/bookings/${id}${sub}`,
      methode === "POST" ? { method: "POST", body: JSON.stringify(koerper ?? {}) } : {});
    const dicht = r.status === 404 || r.status === 401 || r.status === 403;
    check(`${name.padEnd(24)} per ID abgewiesen`, dicht, r.status);
  }

  section("A2) Der Tracking-Token funktioniert weiterhin (Gast-Verfolgung)");
  const perToken = await get(`/api/bookings/${token}`);
  check("Gast sieht seine Fahrt über den Token", perToken.status === 200, perToken.status);
  check("Und es sind die richtigen Daten", perToken.body?.pickupAddress === "Hauptbahnhof", perToken.body?.pickupAddress);

  section("A3) Der angemeldete Kunde darf seine eigene ID nutzen");
  const eigene = await get(`/api/bookings/${id}`, kunde.cookie);
  check("Eigene Fahrt per ID lesbar", eigene.status === 200, eigene.status);
  // Einen Beleg gibt es erst nach Fahrtende – dafuer die Fahrt abschliessen.
  await prisma.booking.update({
    where: { id },
    data: { status: "ABGESCHLOSSEN", trackingStatus: "BEENDET", fare: 12.5, completedAt: new Date() },
  });
  const beleg = await api(`/api/bookings/${id}/invoice`, {}, kunde.cookie);
  check("Beleg im Konto weiterhin abrufbar", beleg.status === 200, beleg.status);
  const belegFremd = await api(`/api/bookings/${id}/invoice`, {}, fremder.cookie);
  check("Fremder bekommt keinen Beleg", belegFremd.status === 404, belegFremd.status);
  const belegGast = await api(`/api/bookings/${id}/invoice`);
  check("Ohne Anmeldung kein Beleg über die ID", belegGast.status === 404, belegGast.status);

  section("A4) Ein anderer Kunde kommt mit derselben ID nicht durch");
  const fremdLesen = await get(`/api/bookings/${id}`, fremder.cookie);
  check("Fremde Fahrt per ID nicht lesbar", fremdLesen.status === 404, fremdLesen.status);
  const fremdZahlen = await post(`/api/bookings/${id}/pay`, { tip: 25 }, fremder.cookie);
  check("Fremde Fahrt nicht bezahlbar", fremdZahlen.status === 404, fremdZahlen.status);
  const fremdStorno = await post(`/api/bookings/${id}/cancel`, {}, fremder.cookie);
  check("Fremde Fahrt nicht stornierbar", fremdStorno.status === 404, fremdStorno.status);
  const nachher = await prisma.booking.findUnique({ where: { id }, select: { status: true, tip: true } });
  check("Fahrt ist unverändert", nachher?.status !== "STORNIERT" && (nachher?.tip ?? 0) === 0, nachher);

  // =========================================================================
  section("B) Rate-Limit lässt sich nicht per Header abschalten");
  const falscheIp = { "x-forwarded-for": "127.0.0.1" };
  let abgewiesen = 0;
  let ersterFehlversuch = null;
  for (let i = 0; i < 25; i++) {
    const r = await api("/api/auth/login",
      { method: "POST", body: JSON.stringify({ role: "DRIVER", username: `nichtda${H.uniq()}`.slice(0, 20), password: "falsch" }), headers: falscheIp });
    if (r.status === 429) { abgewiesen++; if (ersterFehlversuch === null) ersterFehlversuch = i + 1; }
  }
  info(`25 Anmeldeversuche mit gefälschtem Header · ${abgewiesen} abgewiesen`);
  // Jeder Versuch nutzt einen anderen Benutzernamen -> das Namens-Limit greift
  // hier nicht. Entscheidend: die gefälschte IP darf nicht als "keine IP"
  // durchgehen und damit das IP-Limit aushebeln.
  const feste = { "x-forwarded-for": "127.0.0.1" };
  // Aufwaermen: direkt nach einem Serverstart uebersetzt Next die Route erst
  // beim ersten Aufruf. Faellt dieser lange Aufruf mitten in die Zaehlschleife,
  // schlagen einzelne Versuche fehl und die Reihe meldet einen Fehler, den es
  // nicht gibt (genau das ist hier schon passiert).
  await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ role: "DRIVER", username: "aufwaermen", password: "falsch" }),
    headers: feste,
  });
  let abgewiesen2 = 0;
  const name = `brute${H.uniq()}`.slice(0, 20);
  for (let i = 0; i < 25; i++) {
    const r = await api("/api/auth/login",
      { method: "POST", body: JSON.stringify({ role: "DRIVER", username: name, password: "falsch" }), headers: feste });
    if (r.status === 429) abgewiesen2++;
  }
  check("Bruteforce auf EINEN Namen wird gebremst", abgewiesen2 > 0, `${abgewiesen2} von 25 abgewiesen`);
  info("Das Limit pro Benutzername greift jetzt unabhängig von der IP.");

  const quelle = fs.readFileSync(path.join(ROOT, "src/lib/ratelimit.ts"), "utf8");
  check("IP wird von rechts gezählt, nicht das erste Element",
    !/x-forwarded-for.*split\(","\)\[0\]/.test(quelle), "split(',')[0] noch vorhanden");
  check("Anzahl vertrauenswürdiger Proxys ist einstellbar", /TRUSTED_PROXY_HOPS/.test(quelle));

  // =========================================================================
  section("C) Zugriffsprotokoll ist nach Mandant getrennt");
  const co2 = await H.registerCompany("SEC2");
  // Einen Eintrag für Firma 1 erzeugen (Krankenfahrten-Pool wird protokolliert).
  await get("/api/admin/medical/pool", co.admin);
  await sleep(300);

  const eigenesLog = await get("/api/admin/accesslog", co.admin);
  check("Eigenes Protokoll abrufbar", eigenesLog.status === 200, eigenesLog.status);
  const fremdesLog = await get("/api/admin/accesslog", co2.admin);
  check("Zweite Firma sieht ihr eigenes (leeres) Protokoll", fremdesLog.status === 200, fremdesLog.status);

  const eigeneIds = new Set((eigenesLog.body?.entries ?? []).map((e) => e.id));
  const ueberschneidung = (fremdesLog.body?.entries ?? []).filter((e) => eigeneIds.has(e.id));
  check("KEINE Überschneidung zwischen den Mandanten", ueberschneidung.length === 0, ueberschneidung.length);
  info(`Firma A: ${eigenesLog.body?.entries?.length ?? 0} Einträge · Firma B: ${fremdesLog.body?.entries?.length ?? 0}`);

  const schema = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
  const modell = schema.slice(schema.indexOf("model AccessLog"));
  check("AccessLog hat eine Mandantenspalte", /companyId\s+String\?/.test(modell.slice(0, 800)));

  // =========================================================================
  section("D) Admin-Bereich ist auch auf dem Handy bedienbar");
  const dash = fs.readFileSync(path.join(ROOT, "src/components/AdminDashboard.tsx"), "utf8");
  check("Mobile Navigation vorhanden", /AdminMobileNav/.test(dash));
  check("Menü lässt sich öffnen", /admin-mobile-toggle/.test(dash));
  check("Abmelden ist auch mobil erreichbar", /admin-mobile-logout/.test(dash));
  check("Navigationsziele kommen aus einer Quelle", /ADMIN_NAV/.test(dash));

  section("E) Kein Provisionsversprechen mehr im Dashboard");
  const sichtbar = dash.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check("Kein fest verdrahtetes '5 %'-Abzeichen", !/"5 %"|>5 %</.test(sichtbar));
  check("Kein '7 %'-Abzeichen", !/"7 %"|>7 %</.test(sichtbar));
  check("Stattdessen: 100 % des Fahrpreises", /100 % des Fahrpreises/.test(sichtbar));


  // ==========================================================================
  section("F) Verfolgung: Token ist der Schluessel, nicht die Auftrags-ID");
  const fCo = await H.registerCompany("SECF");
  await prisma.company.update({ where: { slug: fCo.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });
  const fDrv = await H.createDriver(fCo.admin, "F", H.HBF);
  check("Fahrer angelegt", fDrv.created?.status === 201, fDrv.created?.body?.error ?? fDrv.created?.status);
  check("Fahrer angemeldet", !!fDrv.cookie, fDrv.cookie ? "Cookie da" : "kein Cookie");
  // Bewusst mit Meldung statt Ausnahme: bleibt der Fahrerzustand aus, soll die
  // Reihe das ANZEIGEN und weiterlaufen, nicht wortlos abbrechen.
  let fSock = null;
  try {
    fSock = await H.goOnline(fDrv.cookie, H.HBF);
    check("Fahrer ist online", true);
  } catch (e) {
    check("Fahrer ist online", false, e.message);
  }

  const kId = H.uniq();
  const kMail = `secf${kId}@test.de`.toLowerCase();
  const kReg = await post("/api/customer/register", {
    name: "Sec Kunde", email: kMail, phone: "+4915" + String(kId).slice(-9), password: "Pass1234",
  });
  check("Fahrgast angelegt", kReg.status === 200 || kReg.status === 201, kReg.status);

  const fB = await post("/api/bookings", {
    company: fCo.slug, customerName: "Sec Kunde", customerPhone: "+4915" + String(kId).slice(-9),
    pickupAddress: "Hauptbahnhof", pickup: H.HBF, destAddress: "List", dest: H.LIST,
    paymentMethod: "CASH",
  }, kReg.cookie);
  const fBookingId = fB.body?.id;
  const fToken = fB.body?.booking?.trackingToken;
  check("Auftrag angelegt", fB.status === 201, fB.body?.error);
  check("Verfolgungs-Token wird ausgeliefert", !!fToken && fToken !== fBookingId, fToken ? "vorhanden" : "FEHLT");

  const { io: ioClient } = require("socket.io-client");
  const gast = ioClient(H.BASE, { transports: ["polling", "websocket"], forceNew: true });
  await H.waitFor(gast, "connect", 8000);
  const gastMitId = await H.emitAck(gast, "track:join", { bookingId: fBookingId });
  check("Gast kommt mit der Auftrags-ID NICHT hinein", gastMitId?.ok === false, JSON.stringify(gastMitId));
  const gastMitToken = await H.emitAck(gast, "track:join", { bookingId: fToken });
  check("Gast kommt mit dem Token hinein", gastMitToken?.ok === true, JSON.stringify(gastMitToken)?.slice(0, 80));

  // Angemeldeter Fahrgast: darf seine EIGENE Fahrt auch ueber die ID verfolgen.
  const kSock = ioClient(H.BASE, {
    transports: ["polling", "websocket"], forceNew: true,
    extraHeaders: { Cookie: kReg.cookie },
  });
  await H.waitFor(kSock, "connect", 8000);
  const eigen = await H.emitAck(kSock, "track:join", { bookingId: fBookingId });
  check("Angemeldeter Fahrgast darf per ID auf SEINE Fahrt", eigen?.ok === true, JSON.stringify(eigen)?.slice(0, 80));

  // ... aber nicht auf die eines anderen.
  const k2 = H.uniq();
  const k2Reg = await post("/api/customer/register", {
    name: "Sec Fremd", email: `secg${k2}@test.de`.toLowerCase(),
    phone: "+4915" + String(k2).slice(-9), password: "Pass1234",
  });
  const fremdSock = ioClient(H.BASE, {
    transports: ["polling", "websocket"], forceNew: true,
    extraHeaders: { Cookie: k2Reg.cookie },
  });
  await H.waitFor(fremdSock, "connect", 8000);
  const fremd = await H.emitAck(fremdSock, "track:join", { bookingId: fBookingId });
  check("Fremder Fahrgast kommt per ID NICHT hinein", fremd?.ok === false, JSON.stringify(fremd));

  section("G) Positionen erreichen den Fahrgast auch mit Token");
  const posGast = H.collect(gast, "booking:driverLocation");
  if (!fSock) {
    info("Uebersprungen: der Fahrer kam nicht online.");
  } else {
  await H.waitFor(fSock, "driver:offer", 25000).catch(() => null);
  const ang = await H.emitAck(fSock, "driver:respond", { bookingId: fBookingId, accept: true });
  check("Fahrer nimmt an", ang?.ok === true, JSON.stringify(ang)?.slice(0, 80));
  fSock.emit("driver:location", { lat: H.HBF.lat + 0.001, lng: H.HBF.lng + 0.001 });
  await H.sleep(1200);
  check("Fahrzeugposition kommt beim Token-Gast an", posGast.all().length > 0, `${posGast.all().length} Meldungen`);
  }

  section("H) Kennzeichen-Schnappschuss wird gefuellt");
  const snap = await prisma.booking.findUnique({
    where: { id: fBookingId }, select: { driverNameSnap: true, driverPlateSnap: true },
  });
  check("Fahrername festgehalten", !!snap?.driverNameSnap, snap?.driverNameSnap);
  check("Kennzeichen festgehalten", !!snap?.driverPlateSnap, snap?.driverPlateSnap ?? "LEER");

  section("I) Zentrale kann sich im Chat nicht als Fahrgast ausgeben");
  const adminSock = H.connectSocket(fCo.admin, "admin");
  await H.waitFor(adminSock, "connect", 8000).catch(() => null);
  await H.emitAck(adminSock, "track:join", { bookingId: fBookingId });
  const adminChat = await H.emitAck(adminSock, "chat:send", { bookingId: fBookingId, text: "Hallo" });
  check("Chat-Versand der Zentrale wird abgelehnt", adminChat?.ok === false, JSON.stringify(adminChat));
  const alsKunde = await prisma.chatMessage.count({ where: { bookingId: fBookingId, sender: "CUSTOMER" } });
  check("Keine Nachricht im Namen des Fahrgasts", alsKunde === 0, `${alsKunde} Nachrichten`);

  section("J) Storno-Protokoll: Fahrt ohne Firma bleibt geschuetzt");
  const ohneFirma = await prisma.booking.create({
    data: {
      customerName: "Ohne Firma", customerPhone: "+4915000000001",
      pickupAddress: "A", destAddress: "B", pickupLat: H.HBF.lat, pickupLng: H.HBF.lng,
      destLat: H.LIST.lat, destLng: H.LIST.lng, paymentMethod: "CASH", status: "OFFEN",
    },
    select: { id: true },
  });
  const fremdeFirma = await H.registerCompany("SECJ");
  const zugriff = await H.get(`/api/admin/bookings/${ohneFirma.id}/cancellations`, fremdeFirma.admin);
  check("Fremde Firma sieht das Protokoll nicht", zugriff.status === 404 || zugriff.status === 403, zugriff.status);

  section("K) Adresssuche ist gedrosselt");
  // Bewusst der SCHNELLE Pfad: ungueltige Koordinaten kehren sofort zurueck,
  // ohne den kostenpflichtigen Kartendienst zu fragen. Die Drossel sitzt
  // davor und wird trotzdem geprueft. (Mit echten Adressabfragen lief diese
  // Schleife minutenlang und riss den Testlauf in die Zeitgrenze.)
  // Die Obergrenze ohne erkennbare IP ist bewusst grosszuegig (600), damit
  // eine Proxy-Fehlkonfiguration nicht wie ein Totalausfall aussieht. Lokal
  // gilt genau dieser Topf, deshalb muss die Schleife darueber hinausgehen.
  const deckel = Number(process.env.GEOCODE_LIMIT_ANON ?? 600);
  let code = 200;
  for (let i = 0; i < deckel + 20; i++) {
    const r = await H.get("/api/geocode?reverse=1&lat=x&lng=x&n=" + i);
    if (r.status === 429) { code = 429; break; }
  }
  check("Massenabfragen werden abgewiesen (429)", code === 429, `letzter Status ${code}`);

  section("L) Portal-Anmeldungen sind gegen Durchprobieren geschuetzt");
  for (const [pfad, name] of [["events", "Veranstalter"], ["hotels", "Hotel"], ["institutions", "Einrichtung"]]) {
    let status = 200;
    for (let i = 0; i < 26; i++) {
      const r = await post(`/api/${pfad}/login`, { email: `angriff@test.de`, password: "falsch" + i });
      if (r.status === 429) { status = 429; break; }
    }
    check(`${name}-Login bremst nach vielen Fehlversuchen`, status === 429, `letzter Status ${status}`);
  }


  section("M) Offene Vorbestellungen verraten keine Fahrgastdaten");
  // Die Marktplatz-Liste geht an JEDEN Fahrer JEDER Firma – auch fuer Fahrten,
  // die noch niemand angenommen hat. Frueher stand darin der volle Datensatz.
  const mCo = await H.registerCompany("SECM");
  await prisma.company.update({ where: { slug: mCo.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });
  const mDrv = await H.createDriver(mCo.admin, "M", H.HBF);

  const spaeter = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
  const vorbestellung = await post("/api/bookings", {
    company: mCo.slug, customerName: "Geheim Person", customerPhone: "+4915100000777",
    pickupAddress: "Hauptbahnhof", pickup: H.HBF, destAddress: "List", dest: H.LIST,
    paymentMethod: "CASH", scheduledAt: spaeter,
  });
  check("Vorbestellung angelegt", vorbestellung.status === 201, vorbestellung.body?.error);

  const mSock = H.connectSocket(mDrv.cookie, "driver");
  const zustand = await H.waitFor(mSock, "driver:state", 12000).catch(() => null);
  check("Fahrerzustand erhalten", !!zustand, zustand ? "ok" : "ausgeblieben");
  const offene = zustand?.openScheduled ?? [];
  const alsText = JSON.stringify(offene);
  check("Liste enthaelt offene Vorbestellungen", Array.isArray(offene) && offene.length > 0, `${offene.length} Eintraege`);
  check("KEINE Telefonnummer in der Liste", !/customerPhone/.test(alsText) && !alsText.includes("+4915100000777"));
  check("KEIN Fahrgastname in der Liste", !/customerName/.test(alsText) && !alsText.includes("Geheim Person"));
  check("Keine medizinischen Angaben", !/patientName|medicalType|medicalLabel/.test(alsText));
  check("Zeit und Strecke bleiben sichtbar", /scheduledAt/.test(alsText) && /pickupAddress/.test(alsText));
  mSock.close();

  gast.close(); kSock.close(); fremdSock.close(); adminSock.close(); fSock?.close();

  await prisma.$disconnect();
  finish("ZUGRIFFSSCHUTZ");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
