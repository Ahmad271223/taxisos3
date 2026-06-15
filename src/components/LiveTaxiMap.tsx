"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { VehicleIcon } from "@/components/VehicleIcon";
import { haversineMeters } from "@/lib/geo";
import type { MapMarker } from "@/components/Map";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

const HANNOVER: [number, number] = [52.3759, 9.732];
// Stadt-Durchschnittsgeschwindigkeit fuer ETA-Schaetzung (m/s ~ 30 km/h).
const CITY_MS = 30_000 / 3600;

function formatEta(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

interface UserLoc { lat: number; lng: number }

export function LiveTaxiMap() {
  const router = useRouter();
  const [taxis, setTaxis] = useState<any[]>([]);
  const [available, setAvailable] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [whereTo, setWhereTo] = useState("");
  const [me, setMe] = useState<{ name: string } | null>(null);
  const [userLoc, setUserLoc] = useState<UserLoc | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch("/api/taxis/live")
        .then((r) => r.json())
        .then((d) => {
          if (stop) return;
          setTaxis(d.taxis ?? []);
          setAvailable(d.available ?? 0);
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    load();
    const iv = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.customer?.role === "CUSTOMER") setMe({ name: d.customer.name });
      })
      .catch(() => {});
  }, []);

  // GPS-Position fuer ETA. Stiller Versuch – kein Fehler-Banner.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  // ETA pro Taxi (nur wenn Userposition bekannt). Verwendet Luftlinie x 1.35.
  function etaSeconds(t: { lat: number; lng: number }): number | null {
    if (!userLoc) return null;
    const meters = haversineMeters(userLoc, t) * 1.35;
    return Math.round(meters / CITY_MS);
  }

  const selectedLive = selected ? taxis.find((t) => t.id === selected.id) ?? selected : null;
  const selectedEta = selectedLive ? etaSeconds(selectedLive) : null;

  const markers: MapMarker[] = useMemo(
    () =>
      taxis.map((t) => ({
        id: t.id,
        lat: t.lat,
        lng: t.lng,
        kind: "car" as const,
        color: t.status === "FREI" ? "#10B981" : "#9CA3AF",
        onClick: () => setSelected(t),
      })),
    [taxis],
  );

  // Karten-Mittelpunkt: Userposition wenn vorhanden, sonst erstes Taxi/Hannover.
  const center: [number, number] = userLoc
    ? [userLoc.lat, userLoc.lng]
    : taxis[0]
    ? [taxis[0].lat, taxis[0].lng]
    : HANNOVER;

  // Pickup-Marker fuer User-Standort (falls verfuegbar).
  const allMarkers: MapMarker[] = useMemo(() => {
    const list = [...markers];
    if (userLoc) list.push({ id: "_user", lat: userLoc.lat, lng: userLoc.lng, kind: "pickup", popup: "Ihr Standort" });
    return list;
  }, [markers, userLoc]);

  function submitWhereTo(e: React.FormEvent) {
    e.preventDefault();
    const q = whereTo.trim();
    router.push(q ? `/buchen?to=${encodeURIComponent(q)}` : "/buchen");
  }

  const busy = taxis.length - available;
  // Schnellster freier Wagen fuer Hero-Anzeige
  const fastest = useMemo(() => {
    if (!userLoc) return null;
    let best: { id: string; eta: number } | null = null;
    for (const t of taxis) {
      if (t.status !== "FREI") continue;
      const e = etaSeconds(t);
      if (e == null) continue;
      if (!best || e < best.eta) best = { id: t.id, eta: e };
    }
    return best;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxis, userLoc]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-ink-50" data-testid="live-map-page">
      {/* Vollbild-Karte */}
      <div className="absolute inset-0" data-testid="live-map">
        <Map center={center} markers={allMarkers} fit />
      </div>

      {/* TOP BAR – schlank, ohne Emoji */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
        <div className="pointer-events-auto mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 pt-4">
          <Link
            href="/"
            data-testid="live-back"
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-ink-900 shadow-card ring-1 ring-ink-200 hover:bg-ink-50"
            aria-label="Zurück"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>

          <div className="flex items-center gap-2 rounded-full bg-white px-4 py-2 shadow-card ring-1 ring-ink-200">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
            </span>
            <span className="text-sm font-extrabold text-ink-900" data-testid="available-count">
              {available} verfügbar
            </span>
            <span className="text-xs text-ink-400">· {busy} besetzt</span>
          </div>

          <Link
            href="/konto"
            data-testid="live-account"
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-ink-900 shadow-card ring-1 ring-ink-200 hover:bg-ink-50"
            aria-label="Konto"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
              <path d="M4 21a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </Link>
        </div>

        {/* "Wohin?" Pille */}
        <div className="pointer-events-auto mx-auto mt-3 max-w-3xl px-4">
          <form
            onSubmit={submitWhereTo}
            className="flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-float ring-1 ring-ink-200"
            data-testid="live-search-form"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                <circle cx="12" cy="11" r="3" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 2v3M12 17v3M2 11h3M19 11h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </span>
            <input
              data-testid="live-search-input"
              value={whereTo}
              onChange={(e) => setWhereTo(e.target.value)}
              placeholder="Wohin möchten Sie?"
              className="min-w-0 flex-1 bg-transparent text-base font-semibold text-ink-900 placeholder:text-ink-400 focus:outline-none"
            />
            <button
              type="submit"
              data-testid="live-search-submit"
              className="shrink-0 rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-extrabold text-white transition hover:bg-ink-800"
            >
              Weiter
            </button>
          </form>
          {fastest && !selectedLive && (
            <div className="mt-2 flex items-center justify-center gap-2 text-xs font-semibold text-ink-900" data-testid="fastest-eta">
              <span className="rounded-full bg-white px-3 py-1 shadow-card ring-1 ring-ink-200">
                Schnellster Wagen ca. <span className="text-ink-900">{formatEta(fastest.eta)}</span> bei Ihnen
              </span>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM SHEET – ohne Auswahl: Schnellaktionen */}
      {!selectedLive && (
        <div className="absolute inset-x-0 bottom-0 z-20" data-testid="live-bottom-sheet">
          <div className="mx-auto max-w-3xl">
            <div className="mx-3 mb-3 rounded-3xl bg-white p-5 shadow-float ring-1 ring-ink-200">
              <div className="flex items-center justify-center pb-2.5">
                <span className="h-1 w-10 rounded-full bg-ink-200" />
              </div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-display text-lg font-extrabold tracking-tight text-ink-900">
                    {me ? `Guten Tag, ${me.name.split(" ")[0]}` : "Taxis in der Nähe"}
                  </p>
                  <p className="text-xs text-ink-500">
                    {loaded
                      ? taxis.length === 0
                        ? "Aktuell keine Taxis online."
                        : "Wählen Sie einen Wagen direkt aus der Karte."
                      : "Lade Live-Daten …"}
                  </p>
                </div>
                <span className="rounded-full bg-ink-900 px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-brand-500">LIVE</span>
              </div>

              <div className="grid grid-cols-5 gap-2">
                <QuickTile href="/buchen" testid="quick-now" label="Sofort" primary>
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                </QuickTile>
                <QuickTile href="/buchen/vorbestellung" testid="quick-later" label="Später">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                </QuickTile>
                <QuickTile href="/buchen/krankenfahrt" testid="quick-medical" label="Kranken">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none"><path d="M12 21s-7-5.2-7-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 5.8-7 11-7 11h-4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M12 9v6M9 12h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                </QuickTile>
                <QuickTile href="/buchen/flughafen" testid="quick-airport" label="Flughafen">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none"><path d="m21 16-9-2-7 4v-2l5-3-2-7h2l4 6 4-1 2 2-3 1 4 2Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>
                </QuickTile>
                <QuickTile href="/buchen/gruppe" testid="quick-group" label="Gruppe">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none"><circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="2"/><circle cx="17" cy="10" r="2.4" stroke="currentColor" strokeWidth="2"/><path d="M3 20a6 6 0 0 1 12 0M14 20a4 4 0 0 1 7-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                </QuickTile>
              </div>

              <Link
                href="/buchen"
                data-testid="live-cta-book"
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-ink-900 px-5 py-3.5 text-base font-extrabold text-white shadow-soft transition hover:bg-ink-800"
              >
                Taxi bestellen
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* BOTTOM SHEET – Taxi gewaehlt */}
      {selectedLive && (
        <div className="absolute inset-x-0 bottom-0 z-30" data-testid="taxi-detail">
          <div className="mx-auto max-w-3xl">
            <div className="mx-3 mb-3 overflow-hidden rounded-3xl bg-white shadow-float ring-1 ring-ink-200">
              <div className="flex justify-center pt-2.5">
                <span className="h-1 w-10 rounded-full bg-ink-200" />
              </div>

              <div className="px-5 pb-5 pt-3">
                {/* Header mit Fahrzeug-Silhouette */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5">
                    <span
                      className="grid h-16 w-20 shrink-0 place-items-center rounded-2xl ring-1"
                      style={{
                        background: selectedLive.status === "FREI" ? "#FEF3C7" : "#F3F4F6",
                        borderColor: "#E5E7EB",
                      }}
                    >
                      <VehicleIcon classKey={selectedLive.vehicleClass} className="h-9 w-14 text-ink-900" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-xl font-extrabold tracking-tight text-ink-900" data-testid="taxi-detail-class">
                        {selectedLive.vehicleClassLabel}
                      </p>
                      <p className="text-sm text-ink-500">{selectedLive.name} · {selectedLive.company ?? "Taxi"}</p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                      selectedLive.status === "FREI" ? "bg-green-100 text-green-800" : "bg-ink-100 text-ink-600"
                    }`}
                  >
                    {selectedLive.status === "FREI" ? "verfügbar" : "besetzt"}
                  </span>
                </div>

                {/* ETA Banner */}
                {selectedEta != null && selectedLive.status === "FREI" && (
                  <div className="mt-4 flex items-center justify-between rounded-2xl bg-ink-900 px-4 py-3 text-white" data-testid="taxi-eta">
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-500 text-ink-900">
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                      </span>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Ankunft bei Ihnen</p>
                        <p className="font-display text-lg font-extrabold leading-none">~ {formatEta(selectedEta)}</p>
                      </div>
                    </div>
                    <p className="text-right text-[11px] text-white/60">
                      geschätzt anhand<br />Ihrer Position
                    </p>
                  </div>
                )}

                {/* Fahrzeug-Details */}
                <div className="mt-4 grid grid-cols-2 gap-2.5 text-sm">
                  <Info
                    icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none"><path d="M3 16v-3a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3H3Z" stroke="currentColor" strokeWidth="2"/><path d="M7 10l1.5-4h7L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>}
                    label="Fahrzeug"
                    value={[selectedLive.vehicleColor, selectedLive.vehicleModel].filter(Boolean).join(" ") || "—"}
                  />
                  <Info
                    icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none"><rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="2"/></svg>}
                    label="Kennzeichen"
                    value={selectedLive.vehiclePlate ?? "—"}
                    mono
                  />
                  <Info
                    icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="2"/><circle cx="17" cy="10" r="2" stroke="currentColor" strokeWidth="2"/><path d="M3 20a6 6 0 0 1 12 0M14 20a4 4 0 0 1 7-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>}
                    label="Sitzplätze"
                    value={`${selectedLive.vehicleSeats} Personen`}
                  />
                  <Info
                    icon={<svg viewBox="0 0 24 24" className="h-4 w-4" fill="none"><rect x="5" y="7" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="2"/><path d="M9 7V4h6v3" stroke="currentColor" strokeWidth="2"/></svg>}
                    label="Gepäck"
                    value={`${selectedLive.luggage} Stück`}
                  />
                </div>

                <div className="mt-4 grid grid-cols-[1fr_auto] gap-2.5">
                  <Link
                    href={`/buchen?class=${selectedLive.vehicleClass}${selectedLive.status === "FREI" ? `&driver=${selectedLive.id}` : ""}`}
                    data-testid="taxi-book"
                    className="flex items-center justify-center gap-2 rounded-2xl bg-brand-500 px-5 py-3.5 text-base font-extrabold text-ink-900 shadow-glow transition hover:bg-brand-400"
                  >
                    {selectedLive.status === "FREI" ? "Diesen Wagen bestellen" : `Nächsten ${selectedLive.vehicleClassLabel} bestellen`}
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                  <button
                    onClick={() => setSelected(null)}
                    data-testid="taxi-close"
                    className="rounded-2xl bg-ink-100 px-4 py-3.5 text-sm font-bold text-ink-700 transition hover:bg-ink-200"
                    aria-label="Schließen"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg>
                  </button>
                </div>
                <p className="mt-2.5 text-center text-[11px] text-ink-400">
                  {selectedLive.status === "FREI"
                    ? "Dieses Fahrzeug wird zuerst angefragt. Sagt es nicht zu, finden wir automatisch den nächsten freien Wagen."
                    : "Aktuell besetzt – wir suchen den nächsten freien Wagen dieser Kategorie."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <span className="sr-only"><Brand subtitle="Live-Karte" /></span>
    </main>
  );
}

function Info({ label, value, icon, mono }: { label: string; value: string; icon?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-ink-50 px-3 py-2.5 ring-1 ring-ink-100">
      {icon && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-ink-700 ring-1 ring-ink-200">{icon}</span>}
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">{label}</p>
        <p className={`truncate font-extrabold text-ink-900 ${mono ? "font-mono tracking-wider" : ""}`}>{value}</p>
      </div>
    </div>
  );
}

function QuickTile({
  href,
  label,
  testid,
  primary,
  children,
}: {
  href: string;
  label: string;
  testid: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      data-testid={testid}
      className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 transition active:scale-95 ${
        primary
          ? "bg-brand-500 text-ink-900 shadow-glow hover:bg-brand-400"
          : "bg-ink-50 text-ink-900 ring-1 ring-ink-200 hover:bg-ink-100"
      }`}
    >
      <span className={primary ? "text-ink-900" : "text-ink-700"}>{children}</span>
      <span className="text-[11px] font-extrabold tracking-tight">{label}</span>
    </Link>
  );
}
