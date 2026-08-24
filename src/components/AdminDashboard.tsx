"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket";
import { Brand } from "@/components/Brand";
import { AdminPayments } from "@/components/AdminPayments";
import {
  DRIVER_STATUS_LABEL,
  DRIVER_STATUS_COLOR,
  BOOKING_STATUS_LABEL,
  TRACKING_LABEL,
} from "@/lib/status";
import { formatEuro, formatDateTime } from "@/lib/format";
import type { MapMarker } from "@/components/Map";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });
const FALLBACK: [number, number] = [52.375892, 9.732010]; // Hannover

export function AdminDashboard() {
  const router = useRouter();
  const [authState, setAuthState] = useState<"checking" | "ok">("checking");
  const [drivers, setDrivers] = useState<Record<string, any>>({});
  const [bookings, setBookings] = useState<Record<string, any>>({});
  const [scheduled, setScheduled] = useState<any[]>([]);
  const [today, setToday] = useState<{ trips: number; revenue: number; avgFare: number; platformFee: number; net: number } | null>(null);
  const [month, setMonth] = useState<{ trips: number; revenue: number; platformFee: number; net: number } | null>(null);
  const [cancellations30d, setCancellations30d] = useState<number>(0);
  const [company, setCompany] = useState<{ name: string; slug: string; cityTier?: string } | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [driverDetail, setDriverDetail] = useState<any | null>(null);
  const [sosAlerts, setSosAlerts] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.admin?.role === "ADMIN") setAuthState("ok");
        else router.replace("/admin/login");
      })
      .catch(() => router.replace("/admin/login"));
  }, [router]);

  const loadOverview = () =>
    fetch("/api/admin/overview")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setToday(d.today);
          setMonth(d.month);
          setCancellations30d(d.cancellations30d ?? 0);
          if (d.company) setCompany(d.company);
        }
      })
      .catch(() => {});

  useEffect(() => {
    if (authState !== "ok") return;
    const socket = getSocket("admin");

    const onSnapshot = (s: any) => {
      const dmap: Record<string, any> = {};
      for (const d of s.drivers ?? []) dmap[d.id] = d;
      setDrivers(dmap);
      const bmap: Record<string, any> = {};
      for (const b of s.bookings ?? []) bmap[b.id] = b;
      setBookings(bmap);
      setScheduled(s.scheduled ?? []);
    };
    const onDriver = (d: any) => setDrivers((cur) => ({ ...cur, [d.id]: { ...cur[d.id], ...d } }));
    const onDriverLoc = (p: { id: string; lat: number; lng: number }) =>
      setDrivers((cur) => (cur[p.id] ? { ...cur, [p.id]: { ...cur[p.id], lat: p.lat, lng: p.lng } } : cur));
    const onBooking = (b: any) => {
      setBookings((cur) => ({ ...cur, [b.id]: b }));
      if (b.isScheduled) {
        setScheduled((cur) => {
          const others = cur.filter((x) => x.id !== b.id);
          return ["ABGESCHLOSSEN", "STORNIERT"].includes(b.status) ? others : [...others, b];
        });
      }
      if (b.status === "ABGESCHLOSSEN") loadOverview();
    };
    // SOS-Notfall live (Phase 22): neue Meldung oben einsortieren (dedupe).
    const onSos = (a: any) =>
      setSosAlerts((cur) => (cur.some((x) => x.id === a.id) ? cur : [a, ...cur]));

    socket.on("admin:snapshot", onSnapshot);
    socket.on("admin:driver", onDriver);
    socket.on("admin:driverLocation", onDriverLoc);
    socket.on("admin:booking", onBooking);
    socket.on("admin:sos", onSos);
    socket.on("connect", () => socket.emit("admin:refresh"));

    loadOverview();
    loadSos();
    const t = setInterval(loadOverview, 20000);

    return () => {
      socket.off("admin:snapshot", onSnapshot);
      socket.off("admin:driver", onDriver);
      socket.off("admin:driverLocation", onDriverLoc);
      socket.off("admin:booking", onBooking);
      socket.off("admin:sos", onSos);
      clearInterval(t);
    };
  }, [authState]);

  function loadSos() {
    fetch("/api/admin/sos")
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d) => setSosAlerts(d.alerts ?? []))
      .catch(() => {});
  }

  async function resolveSos(id: string) {
    await fetch("/api/admin/sos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setSosAlerts((cur) => cur.filter((a) => a.id !== id));
  }

  const driverList = useMemo(() => Object.values(drivers), [drivers]);
  const bookingList = useMemo(
    () =>
      Object.values(bookings)
        .filter((b: any) => ["OFFEN", "ZUGEWIESEN", "AKTIV"].includes(b.status))
        .sort((a: any, b: any) => (a.createdAt < b.createdAt ? 1 : -1)),
    [bookings],
  );

  const counts = useMemo(() => {
    const c = { active: 0, frei: 0, besetzt: 0, pause: 0, offline: 0 };
    for (const d of driverList) {
      if (d.status !== "OFFLINE") c.active++;
      if (d.status === "FREI") c.frei++;
      else if (d.status === "BESETZT") c.besetzt++;
      else if (d.status === "PAUSE") c.pause++;
      else c.offline++;
    }
    return c;
  }, [driverList]);

  const markers = useMemo<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    for (const d of driverList) {
      if (d.lat != null && d.lng != null && d.status !== "OFFLINE") {
        m.push({
          id: `drv-${d.id}`,
          lat: d.lat,
          lng: d.lng,
          kind: "car",
          color: DRIVER_STATUS_COLOR[d.status] ?? "#FFC400",
          popup: `${d.name} – ${DRIVER_STATUS_LABEL[d.status]}`,
        });
      }
    }
    for (const b of bookingList) {
      if (["OFFEN", "ZUGEWIESEN"].includes(b.status)) {
        m.push({ id: `pk-${b.id}`, lat: b.pickupLat, lng: b.pickupLng, kind: "pickup", popup: `Abholung: ${b.customerName}` });
      }
    }
    return m;
  }, [driverList, bookingList]);

  const center = useMemo<[number, number]>(() => {
    const withLoc = driverList.filter((d) => d.lat != null && d.lng != null);
    if (!withLoc.length) return FALLBACK;
    const lat = withLoc.reduce((s, d) => s + d.lat, 0) / withLoc.length;
    const lng = withLoc.reduce((s, d) => s + d.lng, 0) / withLoc.length;
    return [lat, lng];
  }, [driverList]);

  function cancel(id: string) {
    getSocket("admin").emit("admin:cancel", { bookingId: id });
  }
  async function logout() {
    await fetch("/api/auth/logout?scope=admin", { method: "POST" });
    router.replace("/admin/login");
  }

  if (authState !== "ok") {
    return (
      <main className="grid min-h-screen place-items-center bg-ink-950 text-white">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
          <p className="mt-4 text-sm text-ink-300">Wird geladen …</p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-ink-50 text-ink-900 lg:flex">
      <AdminSidebar onLogout={logout} companyName={company?.name} />

      <div className="flex-1 lg:ml-72">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-ink-100 bg-white/95 px-5 py-4 backdrop-blur lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="eyebrow text-ink-500">Dashboard</p>
              <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight">
                Hallo, {company?.name?.split(" ")[0] ?? "Zentrale"}
              </h1>
            </div>
            {company && (
              <Link
                href={`/c/${company.slug}`}
                target="_blank"
                data-testid="open-customer-view"
                className="hidden items-center gap-2 rounded-2xl bg-brand-500 px-4 py-2.5 text-sm font-bold text-ink-900 transition hover:bg-brand-400 sm:inline-flex"
              >
                Kundenansicht öffnen ↗
              </Link>
            )}
          </div>
        </header>

        <div className="grid gap-5 px-5 py-5 lg:px-8 lg:py-8">
          {/* SOS-Notfälle (Phase 22): live, ganz oben */}
          {sosAlerts.length > 0 && (
            <div className="rounded-2xl border-2 border-red-500 bg-red-50 p-5" data-testid="admin-sos-panel">
              <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-extrabold text-red-700">
                🆘 Notfälle ({sosAlerts.length})
              </h2>
              <div className="grid gap-2">
                {sosAlerts.map((a) => (
                  <div key={a.id} data-testid={`sos-alert-${a.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3">
                    <div className="min-w-0">
                      <p className="font-bold text-ink-900">{a.customerName} · {a.customerPhone}</p>
                      <p className="text-xs text-ink-500">
                        {new Date(a.createdAt).toLocaleString("de-DE")}{a.message ? ` · ${a.message}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {a.lat != null && a.lng != null && (
                        <a
                          href={`https://maps.google.com/?q=${a.lat},${a.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`sos-map-${a.id}`}
                          className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-bold text-ink-700 hover:border-ink-900"
                        >
                          📍 Karte
                        </a>
                      )}
                      <button
                        onClick={() => resolveSos(a.id)}
                        data-testid={`sos-resolve-${a.id}`}
                        className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-ink-700"
                      >
                        Erledigt
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {company && (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-500 bg-brand-50 px-5 py-3"
              data-testid="customer-link-banner"
            >
              <div className="text-sm">
                <span className="font-bold text-ink-900">Ihr Kunden-Buchungslink: </span>
                <code className="rounded bg-white px-2 py-0.5 font-bold text-brand-700">/c/{company.slug}</code>
                <span className="ml-2 text-ink-600">– diesen Link geben Sie an Ihre Kunden weiter.</span>
              </div>
            </div>
          )}

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi testid="kpi-active" label="Aktive Fahrer" value={counts.active} />
            <Kpi testid="kpi-frei" label="Frei" value={counts.frei} color="#10B981" />
            <Kpi testid="kpi-besetzt" label="Besetzt" value={counts.besetzt} color="#EF4444" />
            <Kpi testid="kpi-bookings" label="Aktive Aufträge" value={bookingList.length} />
            <Kpi testid="kpi-revenue" label="Umsatz heute" value={formatEuro(today?.revenue ?? 0)} accent />
            <Kpi testid="kpi-avg" label="Ø Fahrpreis" value={formatEuro(today?.avgFare ?? 0)} />
          </div>

          {/* Provision & Monat */}
          <div className="card grid gap-3 p-5 sm:grid-cols-4" data-testid="commission-card">
            <div>
              <p className="eyebrow text-ink-500">Tarif­stufe</p>
              <p className="mt-1 font-display text-lg font-extrabold text-ink-900">
                {company?.cityTier === "BIG" ? "Großstadt" : "Klein/Land"}
                <span className="ml-2 rounded bg-brand-500 px-2 py-0.5 text-xs font-bold text-ink-900">
                  {company?.cityTier === "BIG" ? "7 %" : "5 %"}
                </span>
              </p>
            </div>
            <div data-testid="kpi-fee-today">
              <p className="eyebrow text-ink-500">Provision heute</p>
              <p className="mt-1 font-display text-lg font-extrabold text-ink-900">{formatEuro(today?.platformFee ?? 0)}</p>
            </div>
            <div data-testid="kpi-fee-month">
              <p className="eyebrow text-ink-500">Provision diesen Monat</p>
              <p className="mt-1 font-display text-lg font-extrabold text-ink-900">{formatEuro(month?.platformFee ?? 0)}</p>
              <p className="text-xs text-ink-500">aus {formatEuro(month?.revenue ?? 0)} Brutto · {month?.trips ?? 0} Fahrten</p>
            </div>
            <div data-testid="kpi-net-month">
              <p className="eyebrow text-ink-500">Netto-Auszahlung Monat</p>
              <p className="mt-1 font-display text-lg font-extrabold text-green-700">{formatEuro(month?.net ?? 0)}</p>
              <p className="text-xs text-ink-500">{cancellations30d} Stornos in 30 T.</p>
            </div>
            <div className="sm:col-span-4 border-t border-ink-100 pt-3">
              <a
                href="/admin/abo"
                data-testid="subscription-link"
                className="inline-flex items-center gap-2 text-sm font-bold text-ink-700 hover:text-ink-900"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
                  <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M2.5 10h19" stroke="currentColor" strokeWidth="2" />
                </svg>
                Abo &amp; Abrechnung – Tarif, Zahlungsmittel, Rechnungen →
              </a>
              <p className="mt-1 text-xs text-ink-400">
                Fahrpreise gehen zu 100 % an Sie – wir berechnen nur die monatliche Gebühr.
              </p>
            </div>
          </div>

          {/* Zahlungen: bezahlt / ausstehend je abgeschlossener Fahrt */}
          <AdminPayments />

          {/* Krankenfahrten-Zuweisungs-Pool (Einrichtungen) */}
          <MedicalPoolCard drivers={driverList} />

          <div className="grid gap-5 lg:grid-cols-3">
            {/* Live-Karte */}
            <div className="card h-[520px] overflow-hidden p-0 lg:col-span-2" data-testid="live-map">
              <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
                <h2 className="font-display font-bold">Live-Karte</h2>
                <span className="chip bg-green-50 text-green-700">
                  <span className="h-2 w-2 animate-pulseSoft rounded-full bg-green-500" /> Live
                </span>
              </div>
              <div className="relative h-[calc(100%-49px)]">
                <Map center={center} markers={markers} zoom={12} fit={markers.length > 1} />
                {selectedDriverId && (
                  <DriverDetailPanel
                    detail={driverDetail}
                    onClose={() => setSelectedDriverId(null)}
                  />
                )}
              </div>
            </div>

            {/* Fahrerliste */}
            <div className="card flex max-h-[520px] flex-col p-0" data-testid="drivers-list">
              <h2 className="border-b border-ink-100 px-5 py-3 font-display font-bold">Fahrer</h2>
              <div className="flex-1 overflow-auto">
                {driverList.map((d) => (
                  <div key={d.id} onClick={() => setSelectedDriverId(d.id)} className="flex cursor-pointer items-center justify-between gap-2 border-b border-ink-50 px-5 py-3 last:border-0 hover:bg-ink-50">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-ink-900">{d.name}</p>
                      <p className="truncate text-xs text-ink-500">
                        {d.vehicleModel} · <span className="rounded bg-brand-500 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink-900">{d.vehiclePlate}</span>
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded-full px-3 py-1 text-xs font-bold text-white"
                      style={{ backgroundColor: DRIVER_STATUS_COLOR[d.status] ?? "#9CA3AF" }}
                    >
                      {DRIVER_STATUS_LABEL[d.status]}
                    </span>
                  </div>
                ))}
                {driverList.length === 0 && (
                  <p className="px-5 py-6 text-sm text-ink-400">Keine Fahrer angelegt.</p>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Aktive Aufträge */}
            <div className="card p-0" data-testid="active-bookings">
              <h2 className="border-b border-ink-100 px-5 py-3 font-display font-bold">Aktive Aufträge</h2>
              <div className="max-h-96 overflow-auto">
                {bookingList.length === 0 && <p className="px-5 py-6 text-sm text-ink-400">Keine aktiven Aufträge.</p>}
                {bookingList.map((b) => (
                  <div key={b.id} className="border-b border-ink-50 px-5 py-3 text-sm last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{b.customerName}</span>
                      <span className="chip bg-ink-100 text-ink-700">{BOOKING_STATUS_LABEL[b.status]}</span>
                    </div>
                    <p className="mt-1 text-ink-600">{b.pickupAddress} → {b.destAddress}</p>
                    <div className="mt-1 flex items-center justify-between text-xs text-ink-500">
                      <span>{b.driver ? `🚕 ${b.driver.name}` : TRACKING_LABEL[b.trackingStatus]}</span>
                      <button
                        data-testid={`cancel-booking-${b.id}`}
                        onClick={() => cancel(b.id)}
                        className="font-bold text-red-600 hover:underline"
                      >
                        Stornieren
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Vorbestellungen */}
            <div className="card p-0" data-testid="scheduled-bookings">
              <h2 className="border-b border-ink-100 px-5 py-3 font-display font-bold">Vorbestellungen</h2>
              <div className="max-h-96 overflow-auto">
                {scheduled.length === 0 && <p className="px-5 py-6 text-sm text-ink-400">Keine Vorbestellungen.</p>}
                {scheduled.map((b) => (
                  <div key={b.id} className="border-b border-ink-50 px-5 py-3 text-sm last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{formatDateTime(b.scheduledAt)}</span>
                      <span className="text-xs text-ink-500">{b.driver ? `🚕 ${b.driver.name}` : "offen"}</span>
                    </div>
                    <p className="mt-1 text-ink-600">{b.customerName} · {b.pickupAddress} → {b.destAddress}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Zuweisungs-Pool: offene Krankenfahrten/Vorbestellungen der Einrichtungen,
// die (firmenübergreifend) zugewiesen werden müssen. Erste Zentrale, die einen
// Fahrer zuweist, bekommt die Fahrt.
function MedicalPoolCard({ drivers }: { drivers: any[] }) {
  const [pool, setPool] = useState<any[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () =>
    fetch("/api/admin/medical/pool")
      .then((r) => (r.ok ? r.json() : { pool: [] }))
      .then((d) => setPool(d.pool ?? []))
      .catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, []);

  // Freie Fahrer zuerst (sinnvollste Zuweisung), dann der Rest.
  const sortedDrivers = useMemo(() => {
    const order: Record<string, number> = { FREI: 0, PAUSE: 1, BESETZT: 2, OFFLINE: 3 };
    return [...drivers].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [drivers]);

  async function assign(bookingId: string) {
    const driverId = pick[bookingId];
    if (!driverId) return;
    setBusyId(bookingId);
    setErr(null);
    try {
      const res = await fetch("/api/admin/medical/pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, driverId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setErr(d.error ?? "Zuweisung fehlgeschlagen.");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card p-0" data-testid="medical-pool">
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
        <h2 className="flex items-center gap-2 font-display font-bold">
          🏥 Krankenfahrten zuweisen
          {pool.length > 0 && <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-extrabold text-ink-900">{pool.length}</span>}
        </h2>
        <button onClick={load} className="text-xs font-bold text-ink-500 hover:text-ink-900">Aktualisieren</button>
      </div>
      {err && <p className="px-5 py-2 text-sm font-semibold text-red-600" data-testid="pool-error">{err}</p>}
      <div className="max-h-[420px] overflow-auto">
        {pool.length === 0 && <p className="px-5 py-6 text-sm text-ink-400">Keine offenen Krankenfahrten zur Zuweisung.</p>}
        {pool.map((b) => (
          <div key={b.id} data-testid={`pool-ride-${b.id}`} className="border-b border-ink-50 px-5 py-3 last:border-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold text-ink-900">
                  {b.patientName} <span className="font-normal text-ink-400">· {b.institution}</span>
                </p>
                <p className="text-sm text-ink-600">{b.pickupAddress} → {b.destAddress}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 font-semibold">{b.medicalLabel ?? "Fahrt"}</span>
                  <span className="rounded bg-ink-100 px-1.5 py-0.5 font-semibold">{b.vehicleClassIcon} {b.vehicleClassLabel}</span>
                  {b.requiresRamp && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">🦽 Rampe</span>}
                  {b.requiresStretcher && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700">🛏️ Tragestuhl</span>}
                  <span className="font-semibold text-ink-700">{b.scheduledAt ? formatDateTime(b.scheduledAt) : "sofort"}</span>
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                data-testid={`pool-driver-${b.id}`}
                className="field-sm max-w-[220px]"
                value={pick[b.id] ?? ""}
                onChange={(e) => setPick((p) => ({ ...p, [b.id]: e.target.value }))}
              >
                <option value="">Fahrer wählen …</option>
                {sortedDrivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} · {DRIVER_STATUS_LABEL[d.status] ?? d.status}</option>
                ))}
              </select>
              <button
                data-testid={`pool-assign-${b.id}`}
                disabled={!pick[b.id] || busyId === b.id}
                onClick={() => assign(b.id)}
                className="rounded-xl bg-ink-900 px-4 py-2 text-sm font-extrabold text-white transition hover:bg-ink-700 disabled:opacity-40"
              >
                {busyId === b.id ? "Weist zu …" : "Zuweisen"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, color, accent, testid }: { label: string; value: any; color?: string; accent?: boolean; testid?: string }) {
  return (
    <div
      data-testid={testid}
      className={`card p-4 ${accent ? "bg-ink-900 text-white ring-0" : ""}`}
    >
      <p className={`text-[11px] font-bold uppercase tracking-wide ${accent ? "text-brand-500" : "text-ink-500"}`}>{label}</p>
      <p
        className={`mt-1 font-display text-2xl font-extrabold ${accent ? "text-brand-500" : ""}`}
        style={!accent && color ? { color } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function DriverDetailPanel({ detail, onClose }: { detail: any; onClose: () => void }) {
  const d = detail?.driver;
  return (
    <div
      data-testid="driver-detail-panel"
      className="absolute left-4 top-4 z-[400] w-[300px] rounded-2xl bg-white p-4 shadow-float ring-1 ring-ink-100"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow text-ink-500">Fahrer</p>
          <p className="font-display text-lg font-extrabold">{d?.name ?? "lädt …"}</p>
        </div>
        <button onClick={onClose} className="rounded-full p-1 text-ink-500 hover:bg-ink-100" aria-label="Schließen">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
            <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {d && (
        <div className="grid gap-1.5 text-sm">
          <Row label="Username" value={d.username ?? "—"} />
          <Row label="Telefon" value={d.phone ?? "—"} mono />
          <Row label="Fahrzeug" value={`${d.vehicleColor ?? ""} ${d.vehicleModel ?? ""}`.trim() || "—"} />
          <Row label="Kennzeichen" value={d.vehiclePlate ?? "—"} highlight />
          <Row label="Status" value={d.status} />
          {detail?.ratings?.count > 0 && (
            <Row
              label="Bewertung"
              value={`★ ${detail.ratings.avg?.toFixed?.(1) ?? "—"} (${detail.ratings.count})`}
            />
          )}
        </div>
      )}
      {detail?.activeBooking && (
        <div className="mt-3 rounded-xl bg-brand-50 p-3 text-xs">
          <p className="font-bold text-ink-900">Aktive Fahrt</p>
          <p className="mt-0.5 text-ink-700 truncate">{detail.activeBooking.customerName}</p>
          <p className="text-ink-500 truncate">{detail.activeBooking.pickupAddress} → {detail.activeBooking.destAddress}</p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-50 py-1 last:border-0">
      <span className="text-ink-500">{label}</span>
      {highlight ? (
        <span className="rounded bg-brand-500 px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-ink-900">{value}</span>
      ) : (
        <span className={`text-right font-bold text-ink-900 ${mono ? "font-mono" : ""}`}>{value}</span>
      )}
    </div>
  );
}

function AdminSidebar({ onLogout, companyName }: { onLogout: () => void; companyName?: string }) {
  const pathname = usePathname() || "";
  const items = [
    { href: "/admin", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
    { href: "/admin/fahrer", label: "Fahrer", icon: "M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 7a7 7 0 0 1 14 0" },
    { href: "/admin/preise", label: "Preise", icon: "M3 7h18M6 12h12M9 17h6" },
    { href: "/admin/bewertungen", label: "Bewertungen", icon: "M12 2l2.95 6.94L22 9.97l-5.5 4.78L18.18 22 12 18.27 5.82 22l1.68-7.25L2 9.97l7.05-1.03Z" },
  ];
  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-72 lg:flex-col lg:bg-ink-950 lg:px-5 lg:py-6 lg:text-white">
      <Brand href="/admin" subtitle={companyName ?? "Zentrale"} tone="light" />

      <nav className="mt-8 grid gap-1.5">
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              data-testid={`nav-${it.label.toLowerCase()}`}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition ${
                active
                  ? "bg-brand-500 text-ink-900"
                  : "text-ink-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                <path d={it.icon} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {it.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto grid gap-1.5">
        <button
          onClick={onLogout}
          data-testid="admin-logout"
          className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold text-ink-300 transition hover:bg-white/5 hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Ausloggen
        </button>
      </div>
    </aside>
  );
}
