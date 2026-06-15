"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import type { MapMarker } from "@/components/Map";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

const HANNOVER: [number, number] = [52.3759, 9.732];

export function LiveTaxiMap() {
  const router = useRouter();
  const [taxis, setTaxis] = useState<any[]>([]);
  const [available, setAvailable] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [whereTo, setWhereTo] = useState("");
  const [me, setMe] = useState<{ name: string } | null>(null);

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

  const selectedLive = selected ? taxis.find((t) => t.id === selected.id) ?? selected : null;

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

  const center: [number, number] = taxis[0] ? [taxis[0].lat, taxis[0].lng] : HANNOVER;

  function submitWhereTo(e: React.FormEvent) {
    e.preventDefault();
    const q = whereTo.trim();
    router.push(q ? `/buchen?to=${encodeURIComponent(q)}` : "/buchen");
  }

  const busy = taxis.length - available;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-ink-50" data-testid="live-map-page">
      {/* Vollbild-Karte als Hintergrund */}
      <div className="absolute inset-0" data-testid="live-map">
        <Map center={center} markers={markers} fit />
      </div>

      {/* TOP BAR – schwebend, Uber-Stil */}
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
              {available} frei
            </span>
            <span className="text-xs text-ink-500">· {busy} besetzt</span>
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

        {/* "Wohin?" Such-Pille */}
        <div className="pointer-events-auto mx-auto mt-3 max-w-3xl px-4">
          <form
            onSubmit={submitWhereTo}
            className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-float ring-1 ring-ink-200"
            data-testid="live-search-form"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 text-brand-500">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
                <path d="M12 22s8-7.5 8-13a8 8 0 1 0-16 0c0 5.5 8 13 8 13Z" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="9" r="3" stroke="currentColor" strokeWidth="2" />
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
              className="shrink-0 rounded-xl bg-brand-500 px-4 py-2 text-sm font-extrabold text-ink-900 shadow-glow transition hover:bg-brand-400"
            >
              Los
            </button>
          </form>
        </div>
      </div>

      {/* BOTTOM SHEET – wenn kein Taxi gewählt: Übersicht & Schnellaktionen */}
      {!selectedLive && (
        <div className="absolute inset-x-0 bottom-0 z-20" data-testid="live-bottom-sheet">
          <div className="mx-auto max-w-3xl">
            <div className="mx-3 mb-3 rounded-3xl bg-white p-5 shadow-float ring-1 ring-ink-200">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-display text-xl font-extrabold text-ink-900">
                    {me ? `Hallo, ${me.name.split(" ")[0]} 👋` : "Taxis in der Nähe"}
                  </p>
                  <p className="text-xs text-ink-500">
                    {loaded
                      ? taxis.length === 0
                        ? "Aktuell keine Taxis online."
                        : "Tippen Sie auf ein Auto, um Details zu sehen."
                      : "Lade Live-Daten …"}
                  </p>
                </div>
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-extrabold text-green-800">LIVE</span>
              </div>

              {loaded && taxis.length === 0 && (
                <p className="mb-3 rounded-xl bg-ink-50 px-3 py-2 text-center text-xs text-ink-500" data-testid="no-taxis">
                  Gerade sind keine Taxis online. Bitte später erneut schauen.
                </p>
              )}

              {/* Schnellaktionen wie Uber-Tiles */}
              <div className="grid grid-cols-4 gap-2">
                <QuickTile href="/buchen" testid="quick-now" label="Sofort" icon="🚖" highlight />
                <QuickTile href="/buchen/vorbestellung" testid="quick-later" label="Später" icon="🗓️" />
                <QuickTile href="/buchen/flughafen" testid="quick-airport" label="Flughafen" icon="✈️" />
                <QuickTile href="/buchen/gruppe" testid="quick-group" label="Gruppe" icon="👥" />
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

      {/* BOTTOM SHEET – wenn Taxi gewählt: Fahrzeug-Detailkarte */}
      {selectedLive && (
        <div className="absolute inset-x-0 bottom-0 z-30" data-testid="taxi-detail">
          <div className="mx-auto max-w-3xl">
            <div className="mx-3 mb-3 overflow-hidden rounded-3xl bg-white shadow-float ring-1 ring-ink-200">
              {/* Drag-Indikator */}
              <div className="flex justify-center pt-2.5">
                <span className="h-1.5 w-12 rounded-full bg-ink-200" />
              </div>

              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="grid h-16 w-16 place-items-center rounded-2xl text-3xl shadow-soft"
                      style={{ background: selectedLive.status === "FREI" ? "#FFC400" : "#E5E7EB" }}
                    >
                      {selectedLive.vehicleClassIcon}
                    </span>
                    <div>
                      <p className="font-display text-xl font-extrabold text-ink-900" data-testid="taxi-detail-class">
                        {selectedLive.vehicleClassLabel}
                      </p>
                      <p className="text-sm text-ink-500">{selectedLive.company ?? "Taxi"} · {selectedLive.name}</p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${
                      selectedLive.status === "FREI" ? "bg-green-100 text-green-800" : "bg-ink-200 text-ink-600"
                    }`}
                  >
                    {selectedLive.status === "FREI" ? "● frei" : "○ besetzt"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5 text-sm">
                  <Info
                    icon={
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none"><path d="M3 16v-3a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3H3Z" stroke="currentColor" strokeWidth="2"/><path d="M7 10l1.5-4h7L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    }
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
                    {selectedLive.status === "FREI" ? "Dieses Taxi bestellen" : `${selectedLive.vehicleClassLabel} bestellen`}
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
                    ✕
                  </button>
                </div>
                <p className="mt-2.5 text-center text-[11px] text-ink-400">
                  {selectedLive.status === "FREI"
                    ? "Dieses Fahrzeug wird zuerst angefragt. Sagt es nicht zu, suchen wir das nächste freie."
                    : "Aktuell besetzt – wir suchen das nächste freie Fahrzeug dieser Kategorie."}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Versteckter Brand für SEO/AT */}
      <span className="sr-only"><Brand subtitle="Live-Karte" /></span>
    </main>
  );
}

function Info({ label, value, icon, mono }: { label: string; value: string; icon?: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-ink-50 px-3 py-2.5">
      {icon && <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-ink-700 ring-1 ring-ink-200">{icon}</span>}
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
        <p className={`truncate font-extrabold text-ink-900 ${mono ? "font-mono tracking-wider" : ""}`}>{value}</p>
      </div>
    </div>
  );
}

function QuickTile({ href, label, icon, testid, highlight }: { href: string; label: string; icon: string; testid: string; highlight?: boolean }) {
  return (
    <Link
      href={href}
      data-testid={testid}
      className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-3 transition active:scale-95 ${
        highlight
          ? "bg-brand-500 text-ink-900 shadow-glow hover:bg-brand-400"
          : "bg-ink-50 text-ink-900 ring-1 ring-ink-200 hover:bg-ink-100"
      }`}
    >
      <span className="text-2xl leading-none">{icon}</span>
      <span className="text-[11px] font-extrabold">{label}</span>
    </Link>
  );
}
