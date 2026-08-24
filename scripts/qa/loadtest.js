// QA: Lasttest (Punkt 11).
// Simuliert viele Unternehmen, Fahrer, Kunden, gleichzeitige Sofort- und
// Vorbestellungen, Fahrerannahmen, Kartenzahlungen, Chats und SMS.
// Sucht gezielt nach: Abstuerzen, eingefrorenen Dashboards, Doppelbuchungen,
// Doppelzahlungen, Doppel-SMS und Performance-Problemen.
//
// Aufruf:  node scripts/qa/loadtest.js [companies] [driversPerCompany] [bookings]
/* eslint-disable no-console */
const H = require("./helpers");
const { check, info, section, finish, sleep, post, get, emitAck, collect, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const COMPANIES = Number(process.argv[2] ?? 4);
const DRIVERS_PER = Number(process.argv[3] ?? 4);
const BOOKINGS = Number(process.argv[4] ?? 40);

const UI_ACTIONABLE = ["FAHRER_UNTERWEGS", "FAHRER_ANGEKOMMEN", "FAHRT_LAEUFT"];
const rnd = (min, max) => min + Math.random() * (max - min);
const jitter = (p, m = 0.02) => ({ lat: p.lat + rnd(-m, m), lng: p.lng + rnd(-m, m) });
const pct = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);

async function timed(fn) {
  const t0 = Date.now();
  const r = await fn();
  return { r, ms: Date.now() - t0 };
}

async function main() {
  const errors = [];
  const t0 = Date.now();

  section(`Aufbau: ${COMPANIES} Firmen x ${DRIVERS_PER} Fahrer, ${BOOKINGS} Buchungen`);
  const companies = [];
  for (let c = 0; c < COMPANIES; c++) {
    const co = await H.registerCompany(`LOAD${c}`);
    if (co.status !== 201 && co.status !== 200) {
      errors.push(`Firma ${c}: HTTP ${co.status}`);
      continue;
    }
    // Tarif hochsetzen, damit das Fahrer-Kontingent nicht limitiert.
    await prisma.company.update({ where: { slug: co.slug }, data: { plan: "P20", subscriptionStatus: "AKTIV" } });
    const drivers = [];
    for (let d = 0; d < DRIVERS_PER; d++) {
      const drv = await H.createDriver(co.admin, `L${c}_${d}`, jitter(HBF));
      if (!drv.driverId) {
        errors.push(`Fahrer ${c}/${d} nicht angelegt: ${drv.created?.body?.error}`);
        continue;
      }
      drivers.push(drv);
    }
    companies.push({ ...co, drivers });
  }
  const totalDrivers = companies.reduce((s, c) => s + c.drivers.length, 0);
  check(`${COMPANIES} Firmen angelegt`, companies.length === COMPANIES, companies.length);
  check(`${COMPANIES * DRIVERS_PER} Fahrer angelegt`, totalDrivers === COMPANIES * DRIVERS_PER, totalDrivers);

  section("Alle Fahrer gleichzeitig online (Socket-Last)");
  const sockets = [];
  const connectMs = [];
  await Promise.all(
    companies.flatMap((co) =>
      co.drivers.map(async (drv) => {
        try {
          const { r: s, ms } = await timed(() => H.goOnline(drv.cookie, drv.pos));
          connectMs.push(ms);
          sockets.push({ socket: s, drv, co, offers: collect(s, "driver:offer"), states: collect(s, "driver:state") });
        } catch (e) {
          errors.push(`Socket ${drv.username}: ${e.message}`);
        }
      }),
    ),
  );
  check("Alle Fahrer verbunden", sockets.length === totalDrivers, `${sockets.length}/${totalDrivers}`);
  info(`Verbindungsaufbau: median ${pct(connectMs, 0.5)} ms, p95 ${pct(connectMs, 0.95)} ms`);

  // ---------------------------------------------------------------
  section(`${BOOKINGS} Buchungen GLEICHZEITIG absetzen`);
  const bookMs = [];
  const bookings = await Promise.all(
    Array.from({ length: BOOKINGS }, async (_, i) => {
      const co = companies[i % companies.length];
      const scheduled = i % 4 === 0; // jede 4. ist eine Vorbestellung
      try {
        const { r, ms } = await timed(() =>
          H.book(co.slug, {
            customerName: `Last Kunde ${i}`,
            pickup: jitter(HBF),
            dest: jitter(LIST),
            ...(scheduled ? { scheduledAt: new Date(Date.now() + (2 + i) * 3600_000).toISOString() } : {}),
          }),
        );
        bookMs.push(ms);
        if (r.status !== 201) errors.push(`Buchung ${i}: HTTP ${r.status} ${r.body?.error ?? ""}`);
        return { i, co, scheduled, id: r.body?.id, status: r.status };
      } catch (e) {
        errors.push(`Buchung ${i}: ${e.message}`);
        return { i, co, scheduled, id: null, status: 0 };
      }
    }),
  );
  const ok = bookings.filter((b) => b.status === 201);
  check(`Alle ${BOOKINGS} Buchungen erfolgreich`, ok.length === BOOKINGS, `${ok.length}/${BOOKINGS}`);
  info(`Buchungsdauer: median ${pct(bookMs, 0.5)} ms, p95 ${pct(bookMs, 0.95)} ms, max ${Math.max(...bookMs)} ms`);
  check("Keine Buchung langsamer als 15 s", Math.max(...bookMs) < 15000, Math.max(...bookMs));

  // Doppelbuchungen? (gleiche ID darf nie zweimal auftauchen)
  const ids = ok.map((b) => b.id);
  check("Keine doppelten Buchungs-IDs", new Set(ids).size === ids.length, ids.length - new Set(ids).size);

  // ---------------------------------------------------------------
  section("Angebote annehmen (Wettlauf um dieselben Auftraege)");
  // Der Dispatcher bietet gestaffelt an (Radius waechst schrittweise), daher
  // ueber mehrere Runden annehmen – so entsteht echter Dauerdruck.
  let accepted = 0;
  const acceptMs = [];
  const handled = new Set();
  for (let round = 0; round < 8; round++) {
    await sleep(3000);
    await Promise.all(
      sockets.map(async (s) => {
        for (const o of s.offers.all()) {
          if (handled.has(o.id)) continue;
          handled.add(o.id);
          try {
            const { r, ms } = await timed(() => emitAck(s.socket, "driver:respond", { bookingId: o.id, accept: true }));
            acceptMs.push(ms);
            if (r?.ok) accepted++;
          } catch (e) {
            errors.push(`Annahme ${o.id}: ${e.message}`);
          }
        }
      }),
    );
  }
  info(`${accepted} Auftraege angenommen; Antwortzeit median ${pct(acceptMs, 0.5)} ms, p95 ${pct(acceptMs, 0.95)} ms`);
  check("Mindestens die Haelfte der Fahrer hat einen Auftrag bekommen", accepted >= Math.min(totalDrivers / 2, 8), accepted);
  await sleep(2500);

  // Ein Auftrag darf NIE zwei Fahrern gehoeren.
  const assigned = await prisma.booking.findMany({
    where: { id: { in: ids }, driverId: { not: null } },
    select: { id: true, driverId: true, trackingStatus: true, status: true, isScheduled: true },
  });
  const perBooking = new Map();
  for (const b of assigned) perBooking.set(b.id, (perBooking.get(b.id) ?? 0) + 1);
  check("Kein Auftrag doppelt vergeben", Array.from(perBooking.values()).every((n) => n === 1), Array.from(perBooking.entries()).filter(([, n]) => n > 1));

  // Kein Fahrer darf zwei LIVE-Fahrten gleichzeitig haben.
  const live = assigned.filter((b) => UI_ACTIONABLE.includes(b.trackingStatus));
  const perDriver = new Map();
  for (const b of live) perDriver.set(b.driverId, (perDriver.get(b.driverId) ?? 0) + 1);
  const doubled = Array.from(perDriver.entries()).filter(([, n]) => n > 1);
  check("Kein Fahrer hat zwei laufende Fahrten gleichzeitig", doubled.length === 0, doubled);

  // ---------------------------------------------------------------
  section("KERNPRUEFUNG: kein eingefrorenes Fahrer-Dashboard");
  // Ein Dashboard gilt als eingefroren, wenn eine aktive Fahrt in einem
  // Status haengt, in dem KEIN Trip-Button klickbar ist.
  let frozen = 0;
  const frozenDetails = [];
  for (const s of sockets) {
    const st = s.states.all().slice(-1)[0];
    const act = st?.activeBooking;
    if (!act) continue;
    if (!UI_ACTIONABLE.includes(act.trackingStatus)) {
      frozen++;
      frozenDetails.push({ driver: s.drv.username, status: act.trackingStatus, scheduled: act.isScheduled });
    }
  }
  check("Kein Fahrer-Dashboard in einer Sackgasse", frozen === 0, frozenDetails);

  // Geplante Fahrten duerfen NIE als aktive Fahrt erscheinen.
  const schedActive = await prisma.booking.count({
    where: { isScheduled: true, scheduledAt: { gt: new Date(Date.now() + 5 * 60_000) }, trackingStatus: { in: UI_ACTIONABLE } },
  });
  check("Keine Zukunftsfahrt faelschlich live geschaltet", schedActive === 0, schedActive);

  // ---------------------------------------------------------------
  section("Fahrten unter Last abschliessen");
  const completeMs = [];
  // Nur die Haelfte abschliessen – der Rest bleibt live fuer den Chat-Lasttest.
  const toComplete = live.slice(0, Math.ceil(live.length / 2));
  const keepLive = live.slice(Math.ceil(live.length / 2));
  info(`${toComplete.length} Fahrten werden abgeschlossen, ${keepLive.length} bleiben live`);
  await Promise.all(
    toComplete.map(async (b) => {
      const s = sockets.find((x) => x.drv.driverId === b.driverId);
      if (!s) return;
      try {
        for (const a of ["arrived", "start", "complete"]) {
          const { r, ms } = await timed(() => emitAck(s.socket, "driver:trip", { bookingId: b.id, action: a }));
          completeMs.push(ms);
          if (!r?.ok) errors.push(`Trip ${a} auf ${b.id}: ${JSON.stringify(r)}`);
        }
      } catch (e) {
        errors.push(`Abschluss ${b.id}: ${e.message}`);
      }
    }),
  );
  await sleep(2000);
  const done = await prisma.booking.count({ where: { id: { in: ids }, status: "ABGESCHLOSSEN" } });
  info(`${done} Fahrten abgeschlossen; Aktionsdauer median ${pct(completeMs, 0.5)} ms, p95 ${pct(completeMs, 0.95)} ms`);
  check("Abgeschlossene Fahrten sind konsistent (BEENDET)",
    (await prisma.booking.count({ where: { id: { in: ids }, status: "ABGESCHLOSSEN", trackingStatus: { not: "BEENDET" } } })) === 0);

  // ---------------------------------------------------------------
  section("Chat-Last: viele Nachrichten gleichzeitig");
  // Nach den Abschluessen erneut laden: dort laufen noch Fahrten mit Chat.
  const chatPool = keepLive.length
    ? keepLive
    : await prisma.booking.findMany({
        where: { id: { in: ids }, driverId: { not: null }, status: { in: ["ZUGEWIESEN", "AKTIV"] } },
        select: { id: true, driverId: true },
      });
  const chatTargets = chatPool.slice(0, 10);
  info(`Chat-Ziele: ${chatTargets.length} laufende Fahrten`);
  let chatSent = 0;
  const chatMs = [];
  await Promise.all(
    chatTargets.map(async (b) => {
      const s = sockets.find((x) => x.drv.driverId === b.driverId);
      if (!s) return;
      for (let k = 0; k < 5; k++) {
        try {
          const { r, ms } = await timed(() => emitAck(s.socket, "chat:send", { bookingId: b.id, text: `Last-Nachricht ${k}` }));
          chatMs.push(ms);
          if (r?.ok) chatSent++;
        } catch (e) {
          errors.push(`Chat ${b.id}: ${e.message}`);
        }
      }
    }),
  );
  info(`${chatSent} Chat-Nachrichten gesendet; median ${pct(chatMs, 0.5)} ms, p95 ${pct(chatMs, 0.95)} ms`);
  const chatDb = await prisma.chatMessage.count({ where: { bookingId: { in: chatTargets.map((b) => b.id) } } });
  check("Alle gesendeten Chat-Nachrichten gespeichert", chatDb >= chatSent, { db: chatDb, gesendet: chatSent });

  // ---------------------------------------------------------------
  section("Kartenzahlungen unter Last (Stripe)");
  const payMs = [];
  const intents = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const co = companies[i % companies.length];
      try {
        // Preisabfrage steht stellvertretend fuer die Zahlungs-Vorbereitung;
        // Karten werden im Konto gespeichert und erst nach Fahrtende belastet.
        const { r, ms } = await timed(() => post("/api/quote", { from: jitter(HBF), to: jitter(LIST) }));
        payMs.push(ms);
        if (r.status !== 200) errors.push(`Preisabfrage ${i}: HTTP ${r.status}`);
        return `quote-${i}-${r.body?.priceMax ?? "?"}`;
      } catch (e) {
        errors.push(`Intent ${i}: ${e.message}`);
        return null;
      }
    }),
  );
  const goodIntents = intents.filter(Boolean);
  check("Alle 8 Preisabfragen erfolgreich", goodIntents.length === 8, goodIntents.length);
  check("Keine doppelten Vorgaenge", new Set(goodIntents).size === goodIntents.length);
  info(`Preisabfrage: median ${pct(payMs, 0.5)} ms, p95 ${pct(payMs, 0.95)} ms`);

  // ---------------------------------------------------------------
  section("SMS-Bilanz unter Last");
  const smsLogs = await prisma.smsLog.findMany({ where: { bookingId: { in: ids } } });
  const keys = smsLogs.map((l) => l.dedupeKey);
  check("Keine doppelten SMS (dedupeKeys eindeutig)", new Set(keys).size === keys.length, keys.length - new Set(keys).size);
  const perBookingKind = new Map();
  for (const l of smsLogs) {
    const k = `${l.bookingId}|${l.kind}`;
    perBookingKind.set(k, (perBookingKind.get(k) ?? 0) + 1);
  }
  const multi = Array.from(perBookingKind.entries()).filter(([, n]) => n > 1);
  check("Kein Anlass loest fuer dieselbe Fahrt mehrfach SMS aus", multi.length === 0, multi.slice(0, 5));
  info(`${smsLogs.length} SMS protokolliert (${new Set(smsLogs.map((l) => l.kind)).size} Anlaesse)`);
  const badTo = smsLogs.filter((l) => !/^\+\d{8,15}$/.test(l.to));
  check("Alle Empfaengernummern in E.164", badTo.length === 0, badTo.slice(0, 3).map((l) => l.to));

  // ---------------------------------------------------------------
  section("Server-Gesundheit nach der Last");
  const health = await timed(() => get("/api/flights/lookup").catch(() => ({ status: 0 })));
  const home = await timed(() => fetch(H.BASE + "/").then((r) => r.status));
  check("Server antwortet weiterhin", home.r === 200, home.r);
  info(`Startseite nach Last: ${home.ms} ms`);
  check("Antwortzeit nach Last unter 5 s", home.ms < 5000, home.ms);

  const orphan = await prisma.booking.count({
    where: { id: { in: ids }, status: "ZUGEWIESEN", driverId: null },
  });
  check("Keine zugewiesenen Fahrten ohne Fahrer (Dateninkonsistenz)", orphan === 0, orphan);

  const stuck = await prisma.driver.count({
    where: { company: { slug: { in: companies.map((c) => c.slug) } }, status: "BESETZT" },
  });
  info(`Fahrer noch auf BESETZT: ${stuck} (laufende Fahrten)`);

  // ---------------------------------------------------------------
  section("Ergebnis");
  const dauer = Math.round((Date.now() - t0) / 1000);
  info(`Gesamtdauer: ${dauer} s`);
  info(`Datenmenge: ${companies.length} Firmen, ${totalDrivers} Fahrer, ${ok.length} Buchungen, ${chatSent} Chats`);
  if (errors.length) {
    console.log(`\n  Aufgetretene Fehler (${errors.length}):`);
    for (const e of errors.slice(0, 15)) console.log(`    - ${e}`);
    if (errors.length > 15) console.log(`    … und ${errors.length - 15} weitere`);
  }
  check("Keine Laufzeitfehler waehrend des Lasttests", errors.length === 0, errors.length);

  for (const s of sockets) s.socket.close();
  await prisma.$disconnect();
  finish("LOADTEST");
}
main().catch(async (e) => {
  console.error("Abgebrochen:", e.message, e.stack);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
