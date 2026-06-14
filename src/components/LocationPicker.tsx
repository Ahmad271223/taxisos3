"use client";

// Interaktive Karten-Pin-Auswahl: auf die Karte tippen oder die Nadel ziehen,
// um einen Ort exakt zu wählen. Wird via next/dynamic (ssr:false) geladen.

import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";

const TILE_URL =
  process.env.NEXT_PUBLIC_MAP_TILES_URL || "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTRIB = process.env.NEXT_PUBLIC_MAP_TILES_ATTRIB || "&copy; OpenStreetMap, &copy; CARTO";

const pinIcon = L.divIcon({
  className: "tc-marker",
  html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#111827;border:3px solid #FFC400;box-shadow:0 6px 14px rgba(0,0,0,.4)"><span style="transform:rotate(45deg);font-size:15px">📍</span></div>`,
  iconSize: [34, 34],
  iconAnchor: [17, 34],
});

function ClickCapture({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function LocationPicker({
  value,
  center,
  onChange,
}: {
  value: { lat: number; lng: number } | null;
  center: [number, number];
  onChange: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer
      center={value ? [value.lat, value.lng] : center}
      zoom={14}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIB} />
      <ClickCapture onPick={onChange} />
      {value && (
        <Marker
          position={[value.lat, value.lng]}
          icon={pinIcon}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const m = (e.target as L.Marker).getLatLng();
              onChange(m.lat, m.lng);
            },
          }}
        />
      )}
    </MapContainer>
  );
}
