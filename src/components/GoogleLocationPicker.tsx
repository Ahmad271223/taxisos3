"use client";

// Orts-Pin auf der Google-Karte: tippen setzt die Nadel, ziehen verschiebt
// sie. Gleiche Schnittstelle wie LocationPicker (Leaflet).

import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "./googleMapsLoader";
import { PIN_HTML } from "./markerHtml";

const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";

export default function GoogleLocationPicker({
  value,
  center,
  onChange,
}: {
  value: { lat: number; lng: number } | null;
  center: [number, number];
  onChange: (lat: number, lng: number) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const pinRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let abgebrochen = false;
    loadGoogleMaps()
      .then((g) => {
        if (abgebrochen || !divRef.current) return;
        const start = value ? { lat: value.lat, lng: value.lng } : { lat: center[0], lng: center[1] };
        const map = new g.maps.Map(divRef.current, {
          center: start,
          zoom: 14,
          mapId: MAP_ID,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        map.addListener("click", (e: any) => {
          const p = e?.latLng;
          if (p) onChangeRef.current(p.lat(), p.lng());
        });
        mapRef.current = map;
      })
      .catch((e) => console.error("Google Maps:", e?.message ?? e));
    return () => { abgebrochen = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nadel setzen/verschieben, wenn sich der Wert aendert.
  useEffect(() => {
    const map = mapRef.current;
    const g = window.google;
    if (!map || !g) return;
    if (!value) {
      if (pinRef.current) { pinRef.current.map = null; pinRef.current = null; }
      return;
    }
    const pos = { lat: value.lat, lng: value.lng };
    if (!pinRef.current) {
      const huelle = document.createElement("div");
      huelle.innerHTML = PIN_HTML;
      const pin = new g.maps.marker.AdvancedMarkerElement({
        map,
        position: pos,
        content: huelle.firstElementChild ?? huelle,
        gmpDraggable: true,
      });
      pin.addListener("dragend", () => {
        const p = pin.position;
        if (!p) return;
        const lat = typeof p.lat === "function" ? p.lat() : p.lat;
        const lng = typeof p.lng === "function" ? p.lng() : p.lng;
        onChangeRef.current(lat, lng);
      });
      pinRef.current = pin;
    } else {
      pinRef.current.position = pos;
    }
  }, [value]);

  return <div ref={divRef} style={{ height: "100%", width: "100%" }} data-testid="google-location-picker" />;
}
