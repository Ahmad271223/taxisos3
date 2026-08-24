// QA: Alle sieben Dashboards mit echten Daten und echten Aktionen.
//
// Stufe 2 der Oberflächen-Analyse. Stufe 1 (frontend_walk.js) prüft
// Erreichbarkeit und Rollentrennung; hier wird jedes Dashboard so bedient, wie
// es ein Mensch täte: anmelden, Daten laden, etwas ändern, Ergebnis prüfen.
//
// Abgedeckt: Kunde · Fahrer · Unternehmen · Super-Admin · Hotel ·
//            Einrichtung · Event
//
// Aufruf: node scripts/qa/dashboards.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, sleep, api, get, post, patch, del, HBF, LIST, KROEPCKE } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const id = () => H.uniq();
const put = (p, data, cookie) => api(p, { method: "PUT", body: JSON.stringify(data) }, cookie);

async function main() {
  // =========================================================================
  // A) KUNDENKONTO
  // =========================================================================
  section("A) Kundenkonto (/konto)");
  const kId = id();
  const kMail = `dash${kId}@test.de`.toLowerCase();
  const kTel = "+4915" + String(kId).slice(-9);
  const reg = await post("/api/customer/register", { name: "Dash Kunde", email: kMail, phone: kTel, password: "Pass1234" });
  check("Konto anlegen", reg.status === 201 || reg.status === 200, reg.body?.error);
  const k = reg.cookie;

  const prof = await get("/api/customer/profile", k);
  check("Profil wird geladen", prof.status === 200, prof.status);
  check("Eigene Daten sind enthalten", (prof.body?.profile?.email ?? prof.body?.email) === kMail, prof.body?.profile?.email);

  // Aenderbar ist im Konto NUR der Notfallkontakt – Name, E-Mail und Telefon
  // sind bewusst gesperrt (Telefon haengt an der SMS-Verifizierung).
  const notfall = await patch("/api/customer/profile", {
    emergencyContactName: "Maria Muster", emergencyContactPhone: "+4915100000555",
  }, k);
  check("Notfallkontakt lässt sich speichern", notfall.status === 200, notfall.body?.error);
  const prof2 = await get("/api/customer/profile", k);
  check("Notfallkontakt ist gespeichert", (prof2.body?.profile?.emergencyContactName) === "Maria Muster", prof2.body?.profile?.emergencyContactName);
  const versuch = await patch("/api/customer/profile", { name: "Fremder Name" }, k);
  const danach = await get("/api/customer/profile", k);
  check("Name lässt sich NICHT über die Schnittstelle ändern",
    (danach.body?.profile?.name) === "Dash Kunde", danach.body?.profile?.name);

  const meine = await get("/api/customer/bookings", k);
  check("Fahrtenliste lädt", meine.status === 200 && Array.isArray(meine.body?.bookings), meine.status);

  const karten = await get("/api/customer/payment-methods", k);
  check("Zahlungsmethoden laden", karten.status === 200 && Array.isArray(karten.body?.cards), karten.status);
  check("Kartenzahlung ist eingerichtet", karten.body?.stripeConfigured === true, karten.body?.stripeConfigured);

  // =========================================================================
  // B) UNTERNEHMEN
  // =========================================================================
  section("B) Unternehmens-Dashboard (/admin)");
  const co = await H.registerCompany("DASH");
  await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });

  const uebersicht = await get("/api/admin/overview", co.admin);
  check("Kennzahlen laden", uebersicht.status === 200, uebersicht.status);

  const drv = await H.createDriver(co.admin, "DA", HBF);
  check("Fahrer anlegen", drv.created.status === 201, drv.created.body?.error);
  const liste = await get("/api/admin/drivers", co.admin);
  check("Fahrerliste enthält ihn", (liste.body?.drivers ?? []).some((d) => d.id === drv.driverId), liste.body?.drivers?.length);

  const geaendert = await patch(`/api/admin/drivers/${drv.driverId}`, { name: "Fahrer Umbenannt" }, co.admin);
  check("Fahrer bearbeiten", geaendert.status === 200, geaendert.body?.error);

  const preise = await get("/api/admin/pricing", co.admin);
  check("Preise laden", preise.status === 200, preise.status);
  // Das Schema verlangt getrennte Kilometerpreise fuer Tag, Nacht und Wochenende.
  const preisNeu = await put("/api/admin/pricing", {
    basePrice: 4.2, perKmDay: 2.4, perKmNight: 2.8, perKmWeekend: 2.6, perMinute: 0.5,
  }, co.admin);
  check("Preise ändern", preisNeu.status === 200, preisNeu.body?.error);
  const preisProbe = await get("/api/admin/pricing", co.admin);
  const p = preisProbe.body?.pricing ?? preisProbe.body;
  check("Neuer Grundpreis ist gespeichert", Number(p?.basePrice) === 4.2, p?.basePrice);

  const klassen = await get("/api/admin/vehicle-classes", co.admin);
  check("Fahrzeugklassen laden", klassen.status === 200, klassen.status);

  const fest = await get("/api/admin/fixed-prices", co.admin);
  check("Festpreise laden", fest.status === 200, fest.status);

  const bew = await get("/api/admin/ratings", co.admin);
  check("Bewertungen laden", bew.status === 200, bew.status);

  const zahlungen = await get("/api/admin/payments", co.admin);
  check("Zahlungsübersicht lädt", zahlungen.status === 200, zahlungen.status);

  const abo = await get("/api/admin/subscription", co.admin);
  check("Abo-Daten laden", abo.status === 200, abo.status);
  check("Tarif wird ausgewiesen", !!(abo.body?.plan ?? abo.body?.subscription?.plan), abo.body?.plan);

  const connect = await get("/api/admin/connect", co.admin);
  check("Auszahlungskonto-Status lädt", connect.status === 200, connect.status);

  const protokoll = await get("/api/admin/accesslog", co.admin);
  check("Zugriffsprotokoll lädt", protokoll.status === 200, protokoll.status);

  const sos = await get("/api/admin/sos", co.admin);
  check("SOS-Übersicht lädt", sos.status === 200, sos.status);

  const medPool = await get("/api/admin/medical/pool", co.admin);
  check("Krankenfahrten-Pool lädt", medPool.status === 200, medPool.status);
  const medDash = await get("/api/admin/medical/dashboard", co.admin);
  check("Krankenfahrten-Dashboard lädt", medDash.status === 200, medDash.status);

  section("B2) Abrechnung des Unternehmens (/admin/abrechnung)");
  const monat = new Date().toISOString().slice(0, 7);
  const rechnungen = await get("/api/admin/invoices", co.admin);
  info(`/api/admin/invoices → HTTP ${rechnungen.status}`);
  const monatsRechnung = await get(`/api/admin/invoices/${monat}`, co.admin);
  info(`/api/admin/invoices/${monat} → HTTP ${monatsRechnung.status}`);
  // Diese Seite zeigt dem Unternehmen die Provisionsabrechnung. Provision ist
  // abgeschafft -> hier darf nichts entstehen, was 0-€-Rechnungen suggeriert.
  const summe = monatsRechnung.body?.net ?? monatsRechnung.body?.invoice?.net ?? null;
  if (monatsRechnung.status === 200) {
    check("Abrechnung weist keine Provision aus", !summe || summe === 0, summe);
  } else {
    check("Abrechnung ist stillgelegt oder leer", [400, 404, 410].includes(monatsRechnung.status), monatsRechnung.status);
  }

  // =========================================================================
  // C) FAHRER
  // =========================================================================
  section("C) Fahrer-Dashboard (/fahrer)");
  const sock = await H.goOnline(drv.cookie, HBF);
  const offers = H.collect(sock, "driver:offer");
  const zustand = await H.emitAck(sock, "driver:status", { status: "FREI" });
  check("Status auf FREI setzen", zustand?.ok !== false, zustand);

  const fahrt = await post("/api/bookings", {
    company: co.slug, customerName: "Dash Fahrgast", customerPhone: "+4915100000321",
    pickupAddress: "HBF", pickup: HBF, destAddress: "List", dest: LIST, paymentMethod: "CASH",
  });
  check("Fahrt zum Testen angelegt", fahrt.status === 201, fahrt.body?.error);

  let angebot = null;
  try { angebot = await offers.match((o) => o.id === fahrt.body?.id, 40000); } catch { /* leer */ }
  check("Fahrer erhält das Angebot", !!angebot, angebot?.id);
  check("Angebot enthält Abholadresse", !!angebot?.pickupAddress, angebot?.pickupAddress);
  check("Angebot enthält Preis", (angebot?.priceApprox ?? angebot?.priceMax ?? 0) > 0, angebot?.priceApprox);

  const ann = await H.emitAck(sock, "driver:respond", { bookingId: fahrt.body?.id, accept: true });
  check("Angebot annehmen", ann?.ok !== false, ann);
  await sleep(600);

  for (const [aktion, name] of [["arrived", "Angekommen"], ["start", "Fahrt gestartet"], ["complete", "Fahrt beendet"]]) {
    const r = await H.emitAck(sock, "driver:trip", { bookingId: fahrt.body?.id, action: aktion });
    check(`Fahrer meldet: ${name}`, r?.ok !== false, r);
    await sleep(300);
  }
  const fertig = await prisma.booking.findUnique({ where: { id: fahrt.body?.id }, select: { status: true, fare: true } });
  check("Fahrt ist abgeschlossen", fertig?.status === "ABGESCHLOSSEN", fertig?.status);
  check("Fahrpreis wurde berechnet", (fertig?.fare ?? 0) > 0, fertig?.fare);
  sock.close();

  // =========================================================================
  // D) SUPER-ADMIN
  // =========================================================================
  section("D) Super-Admin (/super-admin)");
  const sa = await prisma.company.findFirst({ where: { role: "SUPER_ADMIN" }, select: { email: true } }).catch(() => null);
  if (sa?.email && process.env.SUPER_ADMIN_PASSWORD) {
    const login = await post("/api/auth/login", { email: sa.email, password: process.env.SUPER_ADMIN_PASSWORD });
    const sc = login.cookie;
    const ov = await get("/api/super/overview", sc);
    check("Plattform-Übersicht lädt", ov.status === 200, ov.status);
    check("Abo-Einnahmen werden ausgewiesen", typeof ov.body?.totals?.subscriptionMonthly === "number", ov.body?.totals);
    check("Provisionssumme wird NICHT mehr ausgewiesen", ov.body?.totals?.platformFee === undefined, ov.body?.totals?.platformFee);
    const tickets = await get("/api/super/tickets", sc);
    check("Support-Tickets laden", tickets.status === 200, tickets.status);
  } else {
    info("Kein Super-Admin eingerichtet (SUPER_ADMIN_EMAIL/PASSWORD) – Abschnitt übersprungen.");
    check("Super-Admin-Endpunkte sind ohne Anmeldung dicht", (await get("/api/super/overview")).status === 401);
  }

  // =========================================================================
  // E) HOTEL-PORTAL
  // =========================================================================
  section("E) Hotel-Portal (/hotel)");
  const hId = id();
  const hReg = await post("/api/hotels/register", {
    name: `Hotel Dash ${hId}`, email: `hotel${hId}@test.de`.toLowerCase(),
    password: "Pass1234", phone: "0511777", address: "Bahnhofstr. 1",
  });
  check("Hotel registrieren", hReg.status === 201, hReg.body?.error);
  const h = hReg.cookie;
  const hMe = await get("/api/hotels/me", h);
  check("Hotel-Sitzung funktioniert", !!hMe.body?.hotel?.name, hMe.body?.hotel);

  const gast = await post("/api/hotels/guests", { name: "Gast Meier", roomNumber: "204" }, h);
  check("Gast anlegen", gast.status === 201, gast.body?.error);
  const gaeste = await get("/api/hotels/guests", h);
  check("Gästeliste lädt", gaeste.status === 200 && Array.isArray(gaeste.body?.guests), gaeste.status);

  const hFahrt = await post("/api/hotels/rides", {
    guestName: "Gast Meier", roomNumber: "204",
    pickup: { address: "Hotel", ...HBF }, dest: { address: "Flughafen", ...LIST },
  }, h);
  check("Hotel bestellt eine Fahrt", hFahrt.status === 201, hFahrt.body?.error);
  const hFahrten = await get("/api/hotels/rides", h);
  check("Fahrtenliste des Hotels lädt", hFahrten.status === 200, hFahrten.status);

  const hFirmen = await get("/api/hotels/companies", h);
  check("Bevorzugte Taxiunternehmen laden", hFirmen.status === 200, hFirmen.status);
  const hEin = await get("/api/hotels/settings", h);
  check("Hotel-Einstellungen laden", hEin.status === 200, hEin.status);
  const hRech = await get("/api/hotels/invoice", h);
  check("Hotel-Abrechnung lädt", hRech.status === 200, hRech.status);

  // =========================================================================
  // F) EINRICHTUNGS-PORTAL
  // =========================================================================
  section("F) Einrichtungs-Portal (/einrichtung)");
  const iId = id();
  const iReg = await post("/api/institutions/register", {
    name: `Dialyse Dash ${iId}`, type: "DIALYSE", email: `inst${iId}@test.de`.toLowerCase(),
    password: "Pass1234", phone: "0511888",
  });
  check("Einrichtung registrieren", iReg.status === 201, iReg.body?.error);
  const inst = iReg.cookie;
  const iMe = await get("/api/institutions/me", inst);
  check("Einrichtungs-Sitzung funktioniert", !!iMe.body?.institution?.name, iMe.body?.institution);

  const pat = await post("/api/institutions/patients", { name: "Patient Dash", birthDate: "1950-01-01", mobility: "WHEELCHAIR" }, inst);
  check("Patient anlegen", pat.status === 201, pat.body?.error);
  const paten = await get("/api/institutions/patients", inst);
  check("Patientenliste lädt", paten.status === 200, paten.status);

  const iFahrt = await post("/api/institutions/rides", {
    patientId: pat.body?.patient?.id, pickup: { address: "Heim", ...HBF },
    dest: { address: "Dialyse", ...KROEPCKE }, medicalType: "DIALYSE", vehicleClass: "WHEELCHAIR",
  }, inst);
  check("Fahrt für Patient anlegen", iFahrt.status === 201, iFahrt.body?.error);
  const iDb = await prisma.booking.findUnique({ where: { id: iFahrt.body?.id }, select: { dispatchMode: true } });
  check("Fahrt geht an die Disposition (nicht automatisch an Fahrer)", iDb?.dispatchMode === "ADMIN", iDb?.dispatchMode);

  const iFahrten = await get("/api/institutions/rides", inst);
  check("Fahrtenliste der Einrichtung lädt", iFahrten.status === 200, iFahrten.status);
  const iRech = await get("/api/institutions/invoice", inst);
  check("Monatsabrechnung lädt", iRech.status === 200, iRech.status);

  // =========================================================================
  // G) EVENT-PORTAL
  // =========================================================================
  section("G) Event-Portal (/event)");
  const eId = id();
  const eReg = await post("/api/events/register", {
    name: `Event Dash ${eId}`, email: `event${eId}@test.de`.toLowerCase(),
    password: "Pass1234", phone: "0511999",
  });
  check("Veranstalter registrieren", eReg.status === 201, eReg.body?.error);
  const ev = eReg.cookie;
  const eMe = await get("/api/events/me", ev);
  check("Veranstalter-Sitzung funktioniert", eMe.status === 200, eMe.status);

  for (const [pfad, name] of [
    ["/api/events/list", "Veranstaltungen"],
    ["/api/events/guests", "Gästeliste"],
    ["/api/events/shuttles", "Shuttles"],
    ["/api/events/zones", "Zonen"],
    ["/api/events/promos", "Aktionscodes"],
    ["/api/events/rides", "Fahrten"],
    ["/api/events/corporate", "Firmenmobilität"],
  ]) {
    const r = await get(pfad, ev);
    check(`${name.padEnd(18)} lädt`, r.status === 200, r.status);
  }

  // Abrechnung braucht eine konkrete Veranstaltung (sonst zu Recht 404).
  const veranstaltung = await post("/api/events/list", {
    name: `Messe ${eId}`, startsAt: new Date(Date.now() + 86400000).toISOString(),
  }, ev);
  const evId = veranstaltung.body?.event?.id ?? veranstaltung.body?.id;
  check("Veranstaltung anlegen", veranstaltung.status === 201 || veranstaltung.status === 200, veranstaltung.body?.error);
  if (evId) {
    const abr = await get(`/api/events/billing?eventId=${evId}`, ev);
    check("Abrechnung der Veranstaltung lädt", abr.status === 200, abr.status);
  }
  const ohne = await get("/api/events/billing", ev);
  check("Abrechnung ohne Veranstaltung wird abgewiesen", ohne.status === 404, ohne.status);

  // Rechnungsmodul: die Monatsuebersicht bleibt, das Festschreiben/Versenden nicht.
  section("H) Abrechnung: Umsatzübersicht ja, Provisionsrechnung nein");
  const monatB = new Date().toISOString().slice(0, 7);
  const uebersichtB = await get(`/api/admin/invoices/${monatB}?format=json`, co.admin);
  check("Monatsübersicht lädt weiterhin", uebersichtB.status === 200, uebersichtB.status);
  check("Sie weist keine Provision aus", (uebersichtB.body?.net ?? 0) === 0, uebersichtB.body?.net);
  for (const [pfad, name] of [
    ["/api/admin/invoices", "Rechnungsarchiv"],
    [`/api/admin/invoices/${monatB}/issue`, "Festschreiben"],
    [`/api/admin/invoices/${monatB}/send`, "Versenden"],
  ]) {
    const istGet = pfad.endsWith("invoices");
    const r = await api(pfad, istGet ? {} : { method: "POST", body: "{}" }, co.admin);
    check(`${name.padEnd(18)} ist stillgelegt`, r.status === 410, { status: r.status, code: r.body?.code });
  }

  await prisma.$disconnect();
  finish("ALLE-DASHBOARDS");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
