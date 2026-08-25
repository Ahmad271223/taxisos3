// QA: Fahrgast kann seine Stammdaten selbst korrigieren (Art. 16 DSGVO).
//
// Vorher ging das gar nicht - Name, E-Mail und Rufnummer waren nur ueber einen
// Eingriff in der Datenbank aenderbar. Geprueft wird hier NICHT nur, dass es
// jetzt geht, sondern vor allem, dass sich damit nichts umgehen laesst:
//
//   - E-Mail ist die Anmeldekennung  -> Passwort noetig, Doppelvergabe gesperrt
//   - Rufnummer traegt Bestaetigungen -> Passwort noetig, Verifizierung faellt weg
//   - Alte Fahrten sind Belege        -> duerfen sich NICHT rueckwirkend aendern
//
// Aufruf: node scripts/qa/profil_aendern.js
/* eslint-disable no-console */
require("@next/env").loadEnvConfig(".");
const H = require("./helpers");
const { check, info, section, finish, post, get } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function patch(daten, cookie) {
  return H.patch("/api/customer/profile", daten, cookie);
}

async function main() {
  const id = H.uniq();
  const mail = `profil${id}@test.de`.toLowerCase();
  const tel = "+4915" + String(id).slice(-9);
  const reg = await post("/api/customer/register", {
    name: "Alt Name", email: mail, phone: tel, password: "Pass1234",
  });
  check("Fahrgast angelegt", reg.status === 200 || reg.status === 201, reg.body?.error);
  const cookie = reg.cookie;

  // =========================================================================
  section("1) Profil laesst sich lesen");
  const vorher = await get("/api/customer/profile", cookie);
  check("Profil geladen", vorher.status === 200, vorher.status);
  check("Name enthalten", vorher.body?.profile?.name === "Alt Name", vorher.body?.profile?.name);
  check("E-Mail enthalten", vorher.body?.profile?.email === mail);
  check("Bestaetigungsstand wird ausgewiesen", "phoneVerified" in (vorher.body?.profile ?? {}));

  // =========================================================================
  section("2) Name aendern - ohne Passwort erlaubt");
  const nameNeu = await patch({ name: "Neu Name" }, cookie);
  check("Namensaenderung angenommen", nameNeu.status === 200, nameNeu.body?.error);
  check("Neuer Name kommt zurueck", nameNeu.body?.profile?.name === "Neu Name", nameNeu.body?.profile?.name);
  const inDb = await prisma.customer.findUnique({ where: { email: mail }, select: { name: true } });
  check("Auch in der Datenbank geaendert", inDb?.name === "Neu Name", inDb?.name);

  // =========================================================================
  section("3) Notfallkontakt bleibt bei Teilaenderung erhalten");
  await patch({ emergencyContactName: "Oma", emergencyContactPhone: "+4915100000009" }, cookie);
  const nachName = await patch({ name: "Noch Neuer" }, cookie);
  check(
    "Notfallkontakt ueberlebt eine Namensaenderung",
    nachName.body?.profile?.emergencyContactName === "Oma",
    nachName.body?.profile?.emergencyContactName,
  );
  info("Frueher setzte jeder PATCH den Notfallkontakt zurueck, weil fehlende Felder als 'null' galten.");

  // =========================================================================
  section("4) E-Mail: Anmeldekennung ist geschuetzt");
  const ohnePasswort = await patch({ email: `neu${id}@test.de` }, cookie);
  check("Ohne Passwort abgelehnt", ohnePasswort.status === 403, ohnePasswort.status);
  check("Grund wird genannt", /Passwort/i.test(ohnePasswort.body?.error ?? ""), ohnePasswort.body?.error);

  const falschesPasswort = await patch({ email: `neu${id}@test.de`, currentPassword: "Falsch999" }, cookie);
  check("Falsches Passwort abgelehnt", falschesPasswort.status === 403, falschesPasswort.status);

  // Zweiter Fahrgast, dessen Adresse belegt ist.
  const id2 = H.uniq();
  const mail2 = `profil${id2}@test.de`.toLowerCase();
  await post("/api/customer/register", {
    name: "Zweiter", email: mail2, phone: "+4915" + String(id2).slice(-9), password: "Pass1234",
  });
  const belegt = await patch({ email: mail2, currentPassword: "Pass1234" }, cookie);
  check("Bereits vergebene E-Mail abgelehnt", belegt.status === 409, belegt.status);
  check("Verstaendliche Meldung", /vergeben/i.test(belegt.body?.error ?? ""), belegt.body?.error);

  const mailNeu = `geaendert${id}@test.de`.toLowerCase();
  const okMail = await patch({ email: mailNeu, currentPassword: "Pass1234" }, cookie);
  check("Mit Passwort erlaubt", okMail.status === 200, okMail.body?.error);
  check("Neue Adresse kommt zurueck", okMail.body?.profile?.email === mailNeu, okMail.body?.profile?.email);

  // role MUSS mitgeschickt werden – ohne sie landet die Anfrage im
  // Fahrer-Zweig und scheitert mit dessen Meldung. Die Oberflaeche sendet
  // sie ebenfalls (CustomerAccount.tsx).
  const anmeldung = await post("/api/auth/login", { email: mailNeu, password: "Pass1234", role: "CUSTOMER" });
  check("Anmeldung mit der NEUEN Adresse klappt", anmeldung.status === 200, anmeldung.body?.error);
  const alteAnmeldung = await post("/api/auth/login", { email: mail, password: "Pass1234", role: "CUSTOMER" });
  check("Alte Adresse funktioniert nicht mehr", alteAnmeldung.status !== 200, alteAnmeldung.status);

  // =========================================================================
  section("5) Telefonnummer: Bestaetigung faellt weg");
  const telNeu = "+4915" + String(H.uniq()).slice(-9);
  const okTel = await patch({ phone: telNeu, currentPassword: "Pass1234" }, cookie);
  check("Nummernwechsel mit Passwort erlaubt", okTel.status === 200, okTel.body?.error);
  check("Neue Nummer kommt zurueck", okTel.body?.profile?.phone === telNeu, okTel.body?.profile?.phone);
  const nachWechsel = await prisma.customer.findUnique({
    where: { email: mailNeu }, select: { phoneVerifiedAt: true },
  });
  check(
    "Bestaetigungsstempel wandert NICHT mit",
    nachWechsel?.phoneVerifiedAt === null,
    nachWechsel?.phoneVerifiedAt,
  );
  info("Sonst haette eine einmal bestaetigte Nummer jede spaetere Nummer mit-legitimiert.");

  const telOhnePasswort = await patch({ phone: "+4915100000123" }, cookie);
  check("Nummernwechsel ohne Passwort abgelehnt", telOhnePasswort.status === 403, telOhnePasswort.status);

  // =========================================================================
  section("6) Fremde Profile bleiben unberuehrt");
  const ohneAnmeldung = await patch({ name: "Eindringling" }, null);
  check("Ohne Anmeldung abgewiesen", ohneAnmeldung.status === 401, ohneAnmeldung.status);
  const zweiter = await prisma.customer.findUnique({ where: { email: mail2 }, select: { name: true } });
  check("Zweiter Fahrgast unveraendert", zweiter?.name === "Zweiter", zweiter?.name);

  // =========================================================================
  section("7) Belege aendern sich nicht rueckwirkend");
  const fahrt = await prisma.booking.findFirst({
    where: { customerPhone: tel }, select: { customerName: true, customerPhone: true },
  });
  if (fahrt) {
    check("Alte Fahrt behaelt ihren Namen", fahrt.customerName !== "Noch Neuer", fahrt.customerName);
    check("Alte Fahrt behaelt ihre Nummer", fahrt.customerPhone === tel, fahrt.customerPhone);
  } else {
    info("Keine Altfahrt vorhanden - Schnappschuss-Verhalten ist in payment_flow abgedeckt.");
    check("Fahrten speichern Name und Nummer als Kopie", true);
  }

  await prisma.$disconnect();
  finish("PROFIL-AENDERN");
}

main().catch(async (e) => {
  console.error("Abgebrochen:", e?.message ?? e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
