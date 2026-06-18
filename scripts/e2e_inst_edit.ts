// E2E: Krankenfahrt nachträglich ändern (PATCH) und stornieren (DELETE).
//   node --import tsx scripts/e2e_inst_edit.ts [baseUrl]
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
  const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) } });
  const setCookie = res.headers.get("set-cookie");
  let body: any = null; try { body = await res.json(); } catch {}
  return { status: res.status, body, cookie: setCookie ? setCookie.split(";")[0] : null };
}

async function main() {
  const tag = "e2e_ie_" + Date.now();
  const email = `${tag}@inst.test`;
  const pw = "Test1234!";
  const inst = await prisma.institution.create({
    data: { name: "E2E Klinik", type: "KLINIK", email, passwordHash: await hashPassword(pw), active: true, phone: "+490000000000" },
  });
  // Vorbestellung (morgen), OFFEN/GEPLANT -> editierbar.
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const ride = await prisma.booking.create({
    data: {
      institutionId: inst.id, customerName: "Max Patient", customerPhone: "—", patientName: "Max Patient",
      pickupAddress: "Klinik A", pickupLat: 52.37, pickupLng: 9.73, destAddress: "Dialyse B", destLat: 52.40, destLng: 9.70,
      vehicleClass: "WHEELCHAIR", medicalType: "DIALYSE", requiresRamp: false, requiresStretcher: false,
      isScheduled: true, scheduledAt: tomorrow, status: "OFFEN", trackingStatus: "GEPLANT", paymentMethod: "CASH",
      priceApprox: 20, priceMin: 18, priceMax: 24,
    },
  });

  const login = await api("/api/institutions/login", { method: "POST", body: JSON.stringify({ email, password: pw }) });
  check("inst login 200", login.status === 200, login.status);
  const c = login.cookie!;

  // Liste enthält die Fahrt
  const list = await api("/api/institutions/rides", {}, c);
  check("rides list enthält Fahrt", (list.body?.rides ?? []).some((r: any) => r.id === ride.id), list.status);

  // PATCH: Fahrzeug + Rampe + neue Zielzeit ändern
  const newWhen = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const patch = await api(`/api/institutions/rides/${ride.id}`, { method: "PATCH", body: JSON.stringify({
    vehicleClass: "STANDARD", requiresRamp: true, requiresStretcher: true, scheduledAt: newWhen,
    dest: { address: "Reha C", lat: 52.41, lng: 9.69 },
  }) }, c);
  check("PATCH 200", patch.status === 200, patch.body);
  const after = await prisma.booking.findUnique({ where: { id: ride.id } });
  check("vehicleClass geändert", after?.vehicleClass === "STANDARD", after?.vehicleClass);
  check("requiresRamp geändert", after?.requiresRamp === true, after?.requiresRamp);
  check("requiresStretcher geändert", after?.requiresStretcher === true, after?.requiresStretcher);
  check("Ziel geändert", after?.destAddress === "Reha C", after?.destAddress);
  check("Preis neu berechnet (priceApprox != 20)", (after?.priceApprox ?? 20) !== 20, after?.priceApprox);
  check("scheduledAt geändert", Math.abs((after?.scheduledAt?.getTime() ?? 0) - new Date(newWhen).getTime()) < 1000, after?.scheduledAt);

  // DELETE: stornieren
  const del = await api(`/api/institutions/rides/${ride.id}`, { method: "DELETE" }, c);
  check("DELETE 200", del.status === 200, del.body);
  const cancelled = await prisma.booking.findUnique({ where: { id: ride.id } });
  check("Status STORNIERT", cancelled?.status === "STORNIERT", cancelled?.status);

  // Fremde Einrichtung darf nicht ändern (404)
  const otherInst = await prisma.institution.create({ data: { name: "Andere", type: "KLINIK", email: `${tag}b@inst.test`, passwordHash: await hashPassword(pw), active: true } });
  const ride2 = await prisma.booking.create({ data: { institutionId: otherInst.id, customerName: "X", customerPhone: "—", pickupAddress: "a", pickupLat: 52.3, pickupLng: 9.7, destAddress: "b", destLat: 52.4, destLng: 9.6, status: "OFFEN", trackingStatus: "GEPLANT", isScheduled: true, scheduledAt: tomorrow, paymentMethod: "CASH" } });
  const forbidden = await api(`/api/institutions/rides/${ride2.id}`, { method: "PATCH", body: JSON.stringify({ requiresRamp: true }) }, c);
  check("Fremde Fahrt -> 404", forbidden.status === 404, forbidden.status);

  // Cleanup
  await prisma.booking.deleteMany({ where: { institutionId: { in: [inst.id, otherInst.id] } } });
  await prisma.institution.deleteMany({ where: { id: { in: [inst.id, otherInst.id] } } });

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
