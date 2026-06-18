// E2E: Krankenfahrten-Pool-Workflow.
//  - Vorbestellung (ADMIN) landet im Zuweisungs-Pool, NICHT bei Fahrern.
//  - Eine Zentrale weist sie einem eigenen Fahrer zu (erste gewinnt).
//  - Fremde Zentrale / Doppel-Zuweisung werden abgelehnt.
//  - Schnellauftrag (quickOrder) läuft als AUTO-Disposition.
//   node --import tsx scripts/e2e_medical_pool.ts [baseUrl]
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
  const tag = "e2e_mp_" + Date.now();
  const pw = "Test1234!";

  // Zwei Zentralen (A weist zu, B ist „fremd"), je ein Fahrer.
  const compA = await prisma.company.create({ data: { name: "Zentrale A", slug: tag + "-a", email: `${tag}a@co.test`, passwordHash: await hashPassword(pw) } });
  const compB = await prisma.company.create({ data: { name: "Zentrale B", slug: tag + "-b", email: `${tag}b@co.test`, passwordHash: await hashPassword(pw) } });
  const drvA = await prisma.driver.create({ data: { name: "Fahrer A", username: tag + "_a", passwordHash: await hashPassword(pw), companyId: compA.id, vehicleClass: "WHEELCHAIR" } });
  const drvB = await prisma.driver.create({ data: { name: "Fahrer B", username: tag + "_b", passwordHash: await hashPassword(pw), companyId: compB.id, vehicleClass: "WHEELCHAIR" } });

  // Einrichtung + Patient.
  const instEmail = `${tag}@inst.test`;
  const inst = await prisma.institution.create({ data: { name: "E2E Reha", type: "REHA", email: instEmail, passwordHash: await hashPassword(pw), active: true, phone: "+490000000000" } });
  const instLogin = await api("/api/institutions/login", { method: "POST", body: JSON.stringify({ email: instEmail, password: pw }) });
  check("inst login 200", instLogin.status === 200, instLogin.status);
  const ic = instLogin.cookie!;

  // --- Vorbestellung (Pool/ADMIN), morgen ---
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const create = await api("/api/institutions/rides", { method: "POST", body: JSON.stringify({
    patientName: "Pool Patient", vehicleClass: "WHEELCHAIR", medicalType: "DIALYSE", requiresRamp: true,
    pickup: { address: "Klinik", lat: 52.37, lng: 9.73 }, dest: { address: "Dialyse", lat: 52.40, lng: 9.70 },
    scheduledAt: tomorrow, quickOrder: false,
  }) }, ic);
  check("Vorbestellung 201", create.status === 201, create.body);
  const poolId = create.body?.id;
  const dbRide = poolId ? await prisma.booking.findUnique({ where: { id: poolId } }) : null;
  check("dispatchMode ADMIN", dbRide?.dispatchMode === "ADMIN", dbRide?.dispatchMode);
  check("kein Fahrer (nicht disponiert)", dbRide?.driverId == null, dbRide?.driverId);
  check("trackingStatus GEPLANT", dbRide?.trackingStatus === "GEPLANT", dbRide?.trackingStatus);

  // openScheduled (Fahrer-Pool) darf die ADMIN-Fahrt NICHT enthalten.
  const openForDrivers = await prisma.booking.findMany({ where: { isScheduled: true, driverId: null, status: "OFFEN", dispatchMode: "AUTO" }, select: { id: true } });
  check("NICHT im Fahrer-Pool (openScheduled)", !openForDrivers.some((r) => r.id === poolId), openForDrivers.length);

  // --- Admin A: Pool laden ---
  const loginA = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username: compA.email, password: pw, role: "ADMIN" }) });
  check("admin A login 200", loginA.status === 200, loginA.status);
  const ac = loginA.cookie!;
  const pool = await api("/api/admin/medical/pool", {}, ac);
  check("Pool enthält Vorbestellung", (pool.body?.pool ?? []).some((p: any) => p.id === poolId), pool.body);
  const poolItem = (pool.body?.pool ?? []).find((p: any) => p.id === poolId);
  check("Pool zeigt KEINE Versicherungsdaten", poolItem && !("insuranceNumber" in poolItem), Object.keys(poolItem ?? {}));
  check("Pool zeigt Rampe-Bedarf", poolItem?.requiresRamp === true, poolItem?.requiresRamp);

  // --- Fremder Fahrer (Zentrale B) -> 403 ---
  const forbidden = await api("/api/admin/medical/pool", { method: "POST", body: JSON.stringify({ bookingId: poolId, driverId: drvB.id }) }, ac);
  check("fremder Fahrer -> 403", forbidden.status === 403, forbidden.status);

  // --- Zuweisung an eigenen Fahrer A -> 200 ---
  const assign = await api("/api/admin/medical/pool", { method: "POST", body: JSON.stringify({ bookingId: poolId, driverId: drvA.id }) }, ac);
  check("Zuweisung 200", assign.status === 200, assign.body);
  const assigned = await prisma.booking.findUnique({ where: { id: poolId } });
  check("Fahrer A zugewiesen", assigned?.driverId === drvA.id, assigned?.driverId);
  check("companyId = Zentrale A", assigned?.companyId === compA.id, assigned?.companyId);
  check("status ZUGEWIESEN", assigned?.status === "ZUGEWIESEN", assigned?.status);
  check("scheduled bleibt GEPLANT", assigned?.trackingStatus === "GEPLANT", assigned?.trackingStatus);

  // --- Pool ist jetzt leer für diese Fahrt; Doppel-Zuweisung -> 409 ---
  const again = await api("/api/admin/medical/pool", { method: "POST", body: JSON.stringify({ bookingId: poolId, driverId: drvA.id }) }, ac);
  check("Doppel-Zuweisung -> 409", again.status === 409, again.status);
  const pool2 = await api("/api/admin/medical/pool", {}, ac);
  check("Fahrt nicht mehr im Pool", !(pool2.body?.pool ?? []).some((p: any) => p.id === poolId), pool2.body?.pool?.length);

  // --- Schnellauftrag (quickOrder) -> AUTO ---
  const quick = await api("/api/institutions/rides", { method: "POST", body: JSON.stringify({
    patientName: "Sofort Patient", vehicleClass: "WHEELCHAIR", medicalType: "SONSTIGES",
    pickup: { address: "A", lat: 52.37, lng: 9.73 }, dest: { address: "B", lat: 52.40, lng: 9.70 },
    quickOrder: true,
  }) }, ic);
  check("Schnellauftrag 201", quick.status === 201, quick.status);
  const quickRide = quick.body?.id ? await prisma.booking.findUnique({ where: { id: quick.body.id } }) : null;
  check("Schnellauftrag dispatchMode AUTO", quickRide?.dispatchMode === "AUTO", quickRide?.dispatchMode);
  check("Schnellauftrag nicht im ADMIN-Pool", !(await api("/api/admin/medical/pool", {}, ac)).body?.pool?.some((p: any) => p.id === quick.body?.id), null);

  // Cleanup
  await prisma.booking.deleteMany({ where: { institutionId: inst.id } });
  await prisma.driver.deleteMany({ where: { id: { in: [drvA.id, drvB.id] } } });
  await prisma.institution.delete({ where: { id: inst.id } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: { in: [compA.id, compB.id] } } });

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAIL`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
