// QA: Chat Kunde <-> Fahrer inkl. Verbindungsabbruch (Handy gesperrt / App im
// Hintergrund). Deckt Punkt 3 und 4 ab.
// Aufruf: node scripts/qa/chat_offline.js
/* eslint-disable no-console */
const H = require("./helpers");
const { check, info, section, finish, sleep, get, emitAck, collect, waitFor, connectSocket, HBF, LIST } = H;
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Kunden-Socket (ohne Login, wie ein Gast im Browser).
function guestSocket() {
  const { io } = require("socket.io-client");
  return io(H.BASE, { transports: ["polling", "websocket"], forceNew: true });
}

async function main() {
  section("Setup: Fahrt mit zugewiesenem Fahrer");
  const co = await H.registerCompany("CHAT");
  const drv = await H.createDriver(co.admin, "CH", HBF);
  const sd = await H.goOnline(drv.cookie, HBF);
  const offers = collect(sd, "driver:offer");
  const bk = await H.book(co.slug, { customerName: "Chat Kunde", pickup: HBF, dest: LIST });
  check("Fahrt gebucht", bk.status === 201, bk.status);
  const bid = bk.body?.id;
  const token = bk.body?.booking?.trackingToken;
  info(`Buchungs-ID: ${bid}`);
  info(`Tracking-Token: ${token ?? "(keiner)"}`);
  await offers.match((o) => o.id === bid, 25000);
  await emitAck(sd, "driver:respond", { bookingId: bid, accept: true });
  await sleep(600);

  // ---------------------------------------------------------------
  section("1) Gast tritt ueber den TRACKING-TOKEN bei (wie im Browser)");
  const sc = guestSocket();
  await waitFor(sc, "connect", 8000);
  const custMsgs = collect(sc, "chat:message");
  const drvMsgs = collect(sd, "chat:message");
  const joinRef = token ?? bid;
  const join = await emitAck(sc, "track:join", { bookingId: joinRef });
  check("track:join per Token erfolgreich", join?.ok === true, join);
  check("Server liefert die richtige Buchung", join?.booking?.id === bid, join?.booking?.id);

  // ---------------------------------------------------------------
  section("2) Nachricht Kunde -> Fahrer");
  const send1 = await emitAck(sc, "chat:send", { bookingId: joinRef, text: "Hallo, ich stehe am Haupteingang." });
  check("Kunde kann senden (Token-Raum korrekt)", send1?.ok === true, send1);
  let atDriver = null;
  try {
    atDriver = await drvMsgs.match((m) => m.text?.includes("Haupteingang"), 8000);
  } catch {
    atDriver = null;
  }
  check("Fahrer empfaengt die Nachricht sofort", !!atDriver, atDriver);

  // ---------------------------------------------------------------
  section("3) Nachricht Fahrer -> Kunde");
  const send2 = await emitAck(sd, "chat:send", { bookingId: bid, text: "Bin in 2 Minuten da." });
  check("Fahrer kann senden", send2?.ok === true, send2);
  let atCust = null;
  try {
    atCust = await custMsgs.match((m) => m.text?.includes("2 Minuten"), 8000);
  } catch {
    atCust = null;
  }
  check("Kunde empfaengt die Nachricht sofort (Raum = Buchungs-ID)", !!atCust, atCust);

  // ---------------------------------------------------------------
  section("4) Mehrere Nachrichten hintereinander");
  const texts = ["Nachricht 1", "Nachricht 2", "Nachricht 3", "Nachricht 4", "Nachricht 5"];
  for (const t of texts) {
    const r = await emitAck(sc, "chat:send", { bookingId: joinRef, text: t });
    if (!r?.ok) check(`Senden "${t}"`, false, r);
  }
  await sleep(1500);
  const received = texts.filter((t) => drvMsgs.all().some((m) => m.text === t));
  check("Alle 5 Nachrichten kommen beim Fahrer an", received.length === 5, { angekommen: received.length });
  const dbCount = await prisma.chatMessage.count({ where: { bookingId: bid } });
  check("Alle Nachrichten sind gespeichert (7 gesamt)", dbCount === 7, dbCount);

  // ---------------------------------------------------------------
  section("5) HANDY GESPERRT: Kunde offline, Fahrer schreibt weiter");
  sc.disconnect();
  await sleep(800);
  check("Kunden-Socket getrennt", sc.connected === false, sc.connected);

  const offlineTexts = ["Waehrend Sperre 1", "Waehrend Sperre 2"];
  for (const t of offlineTexts) {
    const r = await emitAck(sd, "chat:send", { bookingId: bid, text: t });
    check(`Fahrer sendet "${t}" trotz Kunden-Offline`, r?.ok === true, r);
  }
  await sleep(500);

  // ---------------------------------------------------------------
  section("6) ENTSPERRT: verpasste Nachrichten muessen nachgeladen werden");
  // Genau das macht ChatPanel beim 'connect'- bzw. visibilitychange-Event:
  // erneuter GET auf /api/bookings/<ref>/messages.
  const reload = await get(`/api/bookings/${joinRef}/messages`);
  check("Verlauf ueber die API abrufbar", reload.status === 200, reload.status);
  const all = reload.body?.messages ?? [];
  const missed = offlineTexts.filter((t) => all.some((m) => m.text === t));
  check("Beide waehrend der Sperre gesendeten Nachrichten sind im Verlauf", missed.length === 2, {
    gefunden: missed,
    gesamt: all.length,
  });
  check("Verlauf enthaelt alle 9 Nachrichten", all.length === 9, all.length);

  // Reconnect wie die App: neu verbinden + Raum betreten + weiter chatten.
  const sc2 = guestSocket();
  await waitFor(sc2, "connect", 8000);
  const custMsgs2 = collect(sc2, "chat:message");
  const rejoin = await emitAck(sc2, "track:join", { bookingId: joinRef });
  check("Nach Entsperren: Raum erneut betreten", rejoin?.ok === true, rejoin);
  const afterLock = await emitAck(sd, "chat:send", { bookingId: bid, text: "Nach dem Entsperren" });
  check("Fahrer sendet nach dem Entsperren", afterLock?.ok === true, afterLock);
  let got = null;
  try {
    got = await custMsgs2.match((m) => m.text === "Nach dem Entsperren", 8000);
  } catch {
    got = null;
  }
  check("Kunde empfaengt wieder live (Chat vollstaendig wiederhergestellt)", !!got, got);

  const sendAfter = await emitAck(sc2, "chat:send", { bookingId: joinRef, text: "Bin wieder da" });
  check("Kunde kann nach dem Entsperren wieder senden", sendAfter?.ok === true, sendAfter);

  // ---------------------------------------------------------------
  section("7) Chat-Regeln");
  const empty = await emitAck(sd, "chat:send", { bookingId: bid, text: "   " });
  check("Leere Nachricht wird abgelehnt", empty?.ok === false, empty);
  const foreign = await emitAck(sd, "chat:send", { bookingId: "cmsxnichtvorhanden000000", text: "hi" });
  check("Unbekannte Buchung wird abgelehnt", foreign?.ok === false, foreign);
  const noJoin = guestSocket();
  await waitFor(noJoin, "connect", 8000);
  const sneaky = await emitAck(noJoin, "chat:send", { bookingId: joinRef, text: "Fremdzugriff" });
  check("Ohne track:join kann kein Fremder schreiben", sneaky?.ok === false, sneaky);
  noJoin.close();

  // Nach Fahrtende ist der Chat zu.
  for (const a of ["arrived", "start", "complete"]) {
    await emitAck(sd, "driver:trip", { bookingId: bid, action: a });
    await sleep(200);
  }
  await sleep(700);
  const closed = await emitAck(sd, "chat:send", { bookingId: bid, text: "nach Fahrtende" });
  check("Chat nach Fahrtende geschlossen", closed?.ok === false, closed);

  sc2.close();
  sd.close();
  await prisma.$disconnect();
  finish("CHAT-OFFLINE");
}
main().catch(async (e) => {
  console.error("Abgebrochen:", e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
