"use client";

// Orts-Pin-Auswahl auf der Google-Karte. Wird via next/dynamic (ssr:false)
// geladen. Ohne Schluessel: Hinweis statt Karte (siehe Map.tsx).

import { googleMapsAktiv } from "./googleMapsLoader";
import GoogleLocationPicker from "./GoogleLocationPicker";
import { KarteNichtKonfiguriert } from "./Map";

export default function LocationPicker(props: {
  value: { lat: number; lng: number } | null;
  center: [number, number];
  onChange: (lat: number, lng: number) => void;
}) {
  if (!googleMapsAktiv()) return <KarteNichtKonfiguriert />;
  return <GoogleLocationPicker {...props} />;
}
