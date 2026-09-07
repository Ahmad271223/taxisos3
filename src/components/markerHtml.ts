// Marker-Grafiken als HTML - EINE Quelle fuer Leaflet und Google, damit beide
// Karten identisch aussehen und eine Aenderung nicht an zwei Stellen noetig ist.

import type { MapMarker } from "./mapTypes";

export interface MarkerGrafik {
  html: string;
  /** Breite/Hoehe in Pixeln. */
  size: [number, number];
  /** Wo der Marker die Koordinate beruehrt: Mitte (Fahrzeug) oder Spitze unten (Pin). */
  anchor: "center" | "bottom";
}

export function markerGrafik(m: MapMarker): MarkerGrafik {
  if (m.kind === "car" || m.kind === "driver") {
    const color = m.color ?? "#FFC400";
    return {
      html: `<div style="display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:14px;background:${color};border:3px solid #111827;box-shadow:0 6px 16px rgba(17,24,39,.35);cursor:pointer"><svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M3 16v-3a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3a1 1 0 0 1-1 1h-1v1a1 1 0 1 1-2 0v-1H8v1a1 1 0 1 1-2 0v-1H4a1 1 0 0 1-1-1Z" fill="#111827"/><path d="M7 10l1.5-4h7L17 10" stroke="#111827" stroke-width="2" stroke-linecap="round"/></svg></div>`,
      size: [38, 38],
      anchor: "center",
    };
  }
  // Zwischenstopp: oranger, nummerierter Pin (Mehrziel, Phase 2e).
  if (m.kind === "stop") {
    const color = m.color ?? "#F59E0B";
    return {
      html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid white;box-shadow:0 4px 10px rgba(0,0,0,.35)"><span style="transform:rotate(45deg);color:#111827;font-weight:800;font-size:12px">${m.label ?? "•"}</span></div>`,
      size: [30, 30],
      anchor: "bottom",
    };
  }
  const isPickup = m.kind === "pickup";
  const color = m.color ?? (isPickup ? "#10B981" : "#111827");
  return {
    html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:3px solid white;box-shadow:0 4px 10px rgba(0,0,0,.35)"><span style="transform:rotate(45deg);color:white;font-weight:800;font-size:13px">${isPickup ? "A" : "B"}</span></div>`,
    size: [30, 30],
    anchor: "bottom",
  };
}

/** Die Nadel des Orts-Pickers ("hier abholen"). */
export const PIN_HTML =
  `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#111827;border:3px solid #FFC400;box-shadow:0 6px 14px rgba(0,0,0,.4)"><span style="transform:rotate(45deg);font-size:15px">📍</span></div>`;
