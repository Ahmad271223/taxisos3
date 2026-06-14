"use client";

import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

// Kartenkacheln konfigurierbar (Leaflet bleibt der Renderer). Ohne Env -> CARTO
// (nur Dev/Test). Für LIVE z. B. LocationIQ:
//   NEXT_PUBLIC_MAP_TILES_URL=https://tiles.locationiq.com/v3/streets/r/{z}/{x}/{y}.png?key=pk....
const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILES_URL || "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTRIB =
  process.env.NEXT_PUBLIC_MAP_TILES_ATTRIB || "&copy; OpenStreetMap, &copy; CARTO";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind?: "car" | "pickup" | "dest" | "driver" | "stop";
  color?: string;
  label?: string;
  popup?: string;
  onClick?: () => void;
}

interface MapProps {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  line?: [number, number][];
  /** Initially fit to markers. After the user pans/zooms, the view stays put. */
  fit?: boolean;
  className?: string;
  /** When true the map auto-centers on `center` whenever it changes (only until user interacts). */
  follow?: boolean;
}

function makeIcon(m: MapMarker): L.DivIcon {
  if (m.kind === "car" || m.kind === "driver") {
    const color = m.color ?? "#FFC400";
    return L.divIcon({
      className: "tc-marker",
      html: `<div style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:14px;background:${color};border:3px solid #111827;box-shadow:0 6px 16px rgba(17,24,39,.35);cursor:pointer"><svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M3 16v-3a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3a1 1 0 0 1-1 1h-1v1a1 1 0 1 1-2 0v-1H8v1a1 1 0 1 1-2 0v-1H4a1 1 0 0 1-1-1Z" fill="#111827"/><path d="M7 10l1.5-4h7L17 10" stroke="#111827" stroke-width="2" stroke-linecap="round"/></svg></div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });
  }
  // Zwischenstopp: oranger, nummerierter Pin (Mehrziel, Phase 2e).
  if (m.kind === "stop") {
    const color = m.color ?? "#F59E0B";
    return L.divIcon({
      className: "tc-marker",
      html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid white;box-shadow:0 4px 10px rgba(0,0,0,.35)"><span style="transform:rotate(45deg);color:#111827;font-weight:800;font-size:12px">${m.label ?? "•"}</span></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 30],
    });
  }
  const isPickup = m.kind === "pickup";
  const color = m.color ?? (isPickup ? "#10B981" : "#111827");
  return L.divIcon({
    className: "tc-marker",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid white;box-shadow:0 4px 10px rgba(0,0,0,.35)"><span style="transform:rotate(45deg);color:white;font-weight:800;font-size:13px">${isPickup ? "A" : "B"}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
}

/**
 * Auto-fits the map to the given markers exactly once on mount.
 * After that we never call setView/fitBounds again, so panning and zooming
 * by the user is sticky and the map never "springs back".
 */
function InitialFit({ markers, fit, center }: { markers: MapMarker[]; fit: boolean; center: [number, number] }) {
  const map = useMap();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (fit && markers.length > 1) {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
      done.current = true;
    } else if (markers.length > 0 || center) {
      // setView only once
      map.setView(center, map.getZoom());
      done.current = true;
    }
  }, [map, markers, fit, center]);

  return null;
}

/** Optional "follow" mode that re-centers until the user interacts; then disabled. */
function FollowCenter({ center, enabled }: { center: [number, number]; enabled: boolean }) {
  const map = useMap();
  const lockedRef = useRef(false);
  useMapEvents({
    dragstart: () => {
      lockedRef.current = true;
    },
    zoomstart: () => {
      lockedRef.current = true;
    },
  });
  useEffect(() => {
    if (!enabled || lockedRef.current) return;
    map.setView(center, map.getZoom(), { animate: true });
  }, [center, enabled, map]);
  return null;
}

export default function Map({
  center,
  zoom = 13,
  markers = [],
  line,
  fit,
  follow,
  className,
}: MapProps) {
  const icons = useMemo(() => markers.map((m) => ({ m, icon: makeIcon(m) })), [markers]);

  return (
    <div className={className ?? "h-full w-full"}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom zoomControl className="h-full w-full">
        <TileLayer
          attribution={TILE_ATTRIB}
          url={TILE_URL}
          subdomains="abcd"
          maxZoom={20}
          detectRetina
        />
        {line && line.length > 1 && (
          <>
            <Polyline positions={line} pathOptions={{ color: "#111827", weight: 8, opacity: 0.95 }} />
            <Polyline positions={line} pathOptions={{ color: "#FFC400", weight: 4, opacity: 1 }} />
          </>
        )}
        {icons.map(({ m, icon }) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={icon}
            eventHandlers={m.onClick ? { click: () => m.onClick?.() } : undefined}
          >
            {(m.popup || m.label) && <Popup>{m.popup ?? m.label}</Popup>}
          </Marker>
        ))}
        <InitialFit markers={markers} fit={!!fit} center={center} />
        <FollowCenter center={center} enabled={!!follow} />
      </MapContainer>
    </div>
  );
}
