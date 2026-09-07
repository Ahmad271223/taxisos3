"use client";

// Google-Maps-Darstellung mit derselben Schnittstelle wie die Leaflet-Karte
// (siehe mapTypes.ts). Map.tsx waehlt anhand von NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.
//
// Verhalten ist bewusst identisch zur Leaflet-Karte:
//   - beim ersten Aufbau einmal auf die Marker zoomen (fit), danach nie mehr
//     "zurueckspringen"
//   - im follow-Modus dem Mittelpunkt folgen, bis der Nutzer schiebt/zoomt
//   - Marker werden anhand ihrer id aktualisiert statt neu erzeugt - bei
//     Fahrerpositionen, die alle paar Sekunden kommen, ist das der Unterschied
//     zwischen ruhiger und flackernder Karte.

import { useEffect, useRef, useState } from "react";
import type { MapMarker, MapProps } from "./mapTypes";
import { markerGrafik } from "./markerHtml";
import { loadGoogleMaps } from "./googleMapsLoader";

// Advanced Markers brauchen eine Map-ID. DEMO_MAP_ID ist Googles offiziell
// dokumentierter Platzhalter fuer genau diesen Zweck; eine eigene ID aus der
// Cloud Console laesst sich ueber NEXT_PUBLIC_GOOGLE_MAP_ID setzen (Styling).
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";

function markerElement(m: MapMarker): HTMLElement {
  const g = markerGrafik(m);
  const huelle = document.createElement("div");
  huelle.innerHTML = g.html;
  const el = (huelle.firstElementChild as HTMLElement) ?? huelle;
  // Advanced Markers setzen die Unterkante auf die Koordinate. Fahrzeuge
  // sollen mit der MITTE auf der Koordinate sitzen - daher um die halbe Hoehe
  // nach unten schieben.
  if (g.anchor === "center") el.style.transform = `${el.style.transform ? el.style.transform + " " : ""}translateY(50%)`;
  return el;
}

export default function GoogleMap({
  center,
  zoom = 13,
  markers = [],
  line,
  fit,
  follow,
  className,
}: MapProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<Map<string, any>>(new Map());
  const linienRef = useRef<any[]>([]);
  const infoRef = useRef<any>(null);
  const eingepasst = useRef(false);
  const nutzerHatEingegriffen = useRef(false);
  const [bereit, setBereit] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  // Karte aufbauen (einmal).
  useEffect(() => {
    let abgebrochen = false;
    loadGoogleMaps()
      .then((g) => {
        if (abgebrochen || !divRef.current) return;
        const map = new g.maps.Map(divRef.current, {
          center: { lat: center[0], lng: center[1] },
          zoom,
          mapId: MAP_ID,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        map.addListener("dragstart", () => { nutzerHatEingegriffen.current = true; });
        divRef.current.addEventListener("wheel", () => { nutzerHatEingegriffen.current = true; }, { passive: true });
        mapRef.current = map;
        setBereit(true);
      })
      .catch((e) => {
        console.error("Google Maps:", e?.message ?? e);
        setFehler("Karte konnte nicht geladen werden.");
      });
    return () => { abgebrochen = true; };
    // Nur beim Aufbau - center/zoom werden danach ueber fit/follow gesteuert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marker abgleichen.
  useEffect(() => {
    const map = mapRef.current;
    if (!bereit || !map) return;
    const g = window.google;
    const gesehen = new Set<string>();
    for (const m of markers) {
      gesehen.add(m.id);
      const html = markerGrafik(m).html;
      let am = markerRef.current.get(m.id);
      if (!am) {
        am = new g.maps.marker.AdvancedMarkerElement({
          map,
          position: { lat: m.lat, lng: m.lng },
          content: markerElement(m),
          title: m.label ?? "",
        });
        am.__html = html;
        markerRef.current.set(m.id, am);
      } else {
        am.position = { lat: m.lat, lng: m.lng };
        if (am.__html !== html) {
          am.content = markerElement(m);
          am.__html = html;
        }
      }
      am.__click?.remove?.();
      am.__click = am.addListener("click", () => {
        m.onClick?.();
        if (m.popup || m.label) {
          infoRef.current = infoRef.current ?? new g.maps.InfoWindow();
          infoRef.current.setContent(m.popup ?? m.label ?? "");
          infoRef.current.open({ map, anchor: am });
        }
      });
    }
    for (const [id, am] of markerRef.current) {
      if (!gesehen.has(id)) {
        am.__click?.remove?.();
        am.map = null;
        markerRef.current.delete(id);
      }
    }
  }, [markers, bereit]);

  // Streckenverlauf: dunkler Rand, gelbe Linie - wie bei Leaflet.
  useEffect(() => {
    const map = mapRef.current;
    if (!bereit || !map) return;
    const g = window.google;
    for (const l of linienRef.current) l.setMap(null);
    linienRef.current = [];
    if (line && line.length > 1) {
      const path = line.map(([lat, lng]) => ({ lat, lng }));
      linienRef.current.push(
        new g.maps.Polyline({ map, path, strokeColor: "#111827", strokeWeight: 8, strokeOpacity: 0.95 }),
        new g.maps.Polyline({ map, path, strokeColor: "#FFC400", strokeWeight: 4, strokeOpacity: 1 }),
      );
    }
  }, [line, bereit]);

  // Einmaliges Einpassen.
  useEffect(() => {
    const map = mapRef.current;
    if (!bereit || !map || eingepasst.current) return;
    const g = window.google;
    if (fit && markers.length > 1) {
      const bounds = new g.maps.LatLngBounds();
      for (const m of markers) bounds.extend({ lat: m.lat, lng: m.lng });
      map.fitBounds(bounds, 60);
      g.maps.event.addListenerOnce(map, "idle", () => {
        if (map.getZoom() > 15) map.setZoom(15);
      });
      eingepasst.current = true;
    } else if (markers.length > 0 || center) {
      map.setCenter({ lat: center[0], lng: center[1] });
      eingepasst.current = true;
    }
  }, [bereit, markers, fit, center]);

  // Folgen, bis der Nutzer eingreift.
  useEffect(() => {
    const map = mapRef.current;
    if (!bereit || !map || !follow || nutzerHatEingegriffen.current) return;
    map.panTo({ lat: center[0], lng: center[1] });
  }, [center, follow, bereit]);

  return (
    <div className={className ?? "h-full w-full"}>
      <div ref={divRef} className="h-full w-full" data-testid="google-map" />
      {fehler && (
        <div className="p-3 text-center text-sm text-red-600" role="alert">{fehler}</div>
      )}
    </div>
  );
}
