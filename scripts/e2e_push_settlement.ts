// E2E: Hotel-Settlement (offen/bezahlt), VIP-Transfer-Buchung und Web-Push.
// Setup via Prisma, Assertions via HTTP gegen den laufenden Dev-Server.
//   node --import tsx scripts/e2e_push_settlement.ts [baseUrl]
/* eslint-disable no-console */
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/auth";

const BASE = process.argv[2] || "http://127.0.0.1:3000";
let failures = 0;
function check(name: string, cond: any, extra?: any) {
  if (cond) console.log(`  PASS ${name}`);
  else { failures++; console.log(`  FAIL ${name}${extra !== undefined ? " -> " + JSON.stringify(extra) : ""}`); }
}
async function api(path: string, opts: any = {}, cookie?: string) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  let body: any = null; const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) { try { body = await res.json(); } catch {} }
  else { try { body = await res.text(); } catch {} }
  return { status: res.status, body, ct, cookie: setCookie ? setCookie.split(";")[0] : null };
}

async function main() {
  const tag = "e2e_ps_" + Date.now();
  const hotelEmail = `${tag}@hotel.test`;
  const pw = "Test1234!";

  // --- Setup: Hotel + abgeschlossene Charge-to-Room-Fahrt im aktuellen Monat ---
  const hotel = await prisma.hotel.create({
    data: { name: "E2E Hotel", email: hotelEmail, passwordHash: await hashPassword(pw), active: true, phone: "+490000000000" },
  });
  const company = await prisma.company.findFirst({ select: { id: true } });
  const driver = await prisma.driver.create({
    data: {
      name: "E2E Fahrer", username: tag + "_drv", passwordHash: await hashPassword(pw),
      companyId: company!.id, vehicleClass: "STANDARD",
    },
  });
  const now = new Date();
  const fare = 42.5;
  const booking = await prisma.booking.create({
    data: {
      hotelId: hotel.id, hotelPayment: "ROOM", roomNumber: "501", customerName: "VIP Gast", customerPhone: "—",
      pickupAddress: "Hotel", pickupLat: 52.37, pickupLng: 9.73, destAddress: "Flughafen", destLat: 52.46, destLng: 9.68,
      status: "ABGESCHLOSSEN", trackingStatus: "BEENDET", completedAt: now, fare, driverId: driver.id, paymentMethod: "CASH",
    },
  });
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // --- Hotel-Login ---
  const login = await api("/api/hotels/login", { method: "POST", body: JSON.stringify({ email: hotelEmail, password: pw }) });
  check("hotel login 200", login.status === 200, login.status);
  const hc = login.cookie!;

  // --- Settlement: anfangs offen ---
  let inv = await api(`/api/hotels/invoice?month=${monthKey}`, {}, hc);
  check("invoice 200", inv.status === 200, inv.status);
  check("settlement.open == fare", Math.abs((inv.body?.settlement?.open ?? 0) - fare) < 0.01, inv.body?.settlement);
  check("settlement.paid == 0", (inv.body?.settlement?.paid ?? -1) === 0, inv.body?.settlement);
  const myLine = (inv.body?.lines ?? []).find((l: any) => l.id === booking.id);
  check("line vorhanden, settled=false", myLine && myLine.settled === false, myLine);

  // --- Als bezahlt markieren ---
  const patch = await api(`/api/hotels/invoice`, { method: "PATCH", body: JSON.stringify({ month: monthKey, settled: true }) }, hc);
  check("PATCH settled 200", patch.status === 200 && patch.body?.count >= 1, patch.body);
  inv = await api(`/api/hotels/invoice?month=${monthKey}`, {}, hc);
  check("nach PATCH: paid == fare", Math.abs((inv.body?.settlement?.paid ?? 0) - fare) < 0.01, inv.body?.settlement);
  check("nach PATCH: open == 0", (inv.body?.settlement?.open ?? -1) === 0, inv.body?.settlement);
  const paidLine = (inv.body?.lines ?? []).find((l: any) => l.id === booking.id);
  check("line settled=true", paidLine && paidLine.settled === true, paidLine);

  // --- Zurücksetzen auf offen ---
  const reset = await api(`/api/hotels/invoice`, { method: "PATCH", body: JSON.stringify({ month: monthKey, settled: false }) }, hc);
  check("PATCH reset 200", reset.status === 200, reset.body);
  inv = await api(`/api/hotels/invoice?month=${monthKey}`, {}, hc);
  check("nach reset: open == fare", Math.abs((inv.body?.settlement?.open ?? 0) - fare) < 0.01, inv.body?.settlement);

  // --- VIP-Transfer-Buchung ---
  const ride = await api("/api/hotels/rides", { method: "POST", body: JSON.stringify({
    guestName: "Frau Müller", hotelPayment: "ROOM", isVip: true, discreet: true, nameSign: "Fr. Müller",
    notes: "Champagner bereithalten", roomNumber: "777",
    pickup: { address: "Hotel", lat: 52.37, lng: 9.73 }, dest: { address: "Oper", lat: 52.36, lng: 9.74 },
  }) }, hc);
  check("VIP-Buchung 201", ride.status === 201, ride.status);
  const vipBookingId = ride.body?.id;
  const vip = vipBookingId ? await prisma.booking.findUnique({ where: { id: vipBookingId } }) : null;
  check("VIP vehicleClass=VIP", vip?.vehicleClass === "VIP", vip?.vehicleClass);
  check("VIP isVip=true", vip?.isVip === true, vip?.isVip);
  check("VIP meetGreet=PREMIUM (Namensschild)", vip?.meetGreet === "PREMIUM", vip?.meetGreet);
  check("VIP notes enthält Diskret+Schild+Hinweis",
    !!vip?.notes && vip.notes.includes("Diskrete Abholung") && vip.notes.includes("Namensschild") && vip.notes.includes("Champagner"),
    vip?.notes);

  // --- Web-Push: Key + Subscribe ---
  const key = await api("/api/push/key");
  check("push key enabled + publicKey", key.body?.enabled === true && typeof key.body?.publicKey === "string" && key.body.publicKey.length > 20, key.body);

  const dlogin = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: tag + "_drv", password: pw, role: "DRIVER" }) });
  check("driver login 200", dlogin.status === 200, dlogin.status);
  const dc = dlogin.cookie!;
  const fakeEndpoint = `https://example.com/push/${tag}`;
  const sub = await api("/api/push/subscribe", { method: "POST", body: JSON.stringify({
    subscription: { endpoint: fakeEndpoint, keys: { p256dh: "BPb".padEnd(80, "x"), auth: "abcd".padEnd(20, "y") } },
  }) }, dc);
  check("push subscribe 200", sub.status === 200, sub.body);
  const row = await prisma.pushSubscription.findUnique({ where: { endpoint: fakeEndpoint } });
  check("push subscription gespeichert (driverId stimmt)", row?.driverId === driver.id, row?.driverId);

  // --- Cleanup ---
  await prisma.pushSubscription.deleteMany({ where: { driverId: driver.id } });
  await prisma.booking.deleteMany({ where: { hotelId: hotel.id } });
  await prisma.driver.delete({ where: { id: driver.id } }).catch(() => {});
  await prisma.hotel.delete({ where: { id: hotel.id } }).catch(() => {});

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
