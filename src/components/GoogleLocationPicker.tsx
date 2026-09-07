"use client";

// Orts-Pin auf der Google-Karte: tippen setzt die Nadel, ziehen verschiebt
// sie. Gleiche Schnittstelle wie LocationPicker (Leaflet).

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, beiGoogleMapsAblehnung, ABLEHNUNGS_HINWEIS } from "./googleMapsLoader";
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
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    // Abgelehnter Schluessel -> Hinweis statt Absturz (siehe GoogleMap.tsx).
    const abmelden = beiGoogleMapsAblehnung(() => setFehler(ABLEHNUNGS_HINWEIS));
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
      .catch((e) => {
        console.error("Google Maps:", e?.message ?? e);
        setFehler("Karte konnte nicht geladen werden.");
      });
    return () => { abgebrochen = true; abmelden(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nadel setzen/verschieben, wenn sich der Wert aendert.
  useEffect(() => {
    const map = mapRef.current;
    const g = window.google;
    if (!map || !g || fehler) return;
    try {
      setzeNadel();
    } catch (e: any) {
      console.error("Google Maps (Nadel):", e?.message ?? e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fehler]);

  function setzeNadel() {
    const map = mapRef.current;
    const g = window.google;
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
      pin.addEventListener("dragend", () => {
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
  }

  if (fehler) {
    return (
      <div
        className="flex h-full w-full items-center justify-center rounded-xl bg-ink-50 p-4 text-center text-sm text-ink-500"
        role="alert"
        data-testid="google-map-error"
      >
        {fehler}
      </div>
    );
  }
  return <div ref={divRef} style={{ height: "100%", width: "100%" }} data-testid="google-location-picker" />;
}
