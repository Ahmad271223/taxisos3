"use client";

// Google-Maps-Darstellung mit derselben Schnittstelle wie die fruehere
// Leaflet-Karte (siehe mapTypes.ts).
//
// Verhalten:
//   - beim ersten Aufbau einmal auf die Marker zoomen (fit), danach nie mehr
//     "zurueckspringen"
//   - im follow-Modus dem Mittelpunkt folgen, bis der Nutzer schiebt/zoomt
//   - Marker werden anhand ihrer id aktualisiert statt neu erzeugt - bei
//     Fahrerpositionen, die alle paar Sekunden kommen, ist das der Unterschied
//     zwischen ruhiger und flackernder Karte
//   - lehnt Google den Schluessel ab (falsche Domain, API aus), erscheint ein
//     Hinweis statt einer leeren Flaeche - und die Seite bleibt bedienbar.
//     Alle Aufrufe in die Bibliothek sind abgesichert, weil Google sich nach
//     einer Ablehnung selbst abschaltet und danach jeder Aufruf wirft.

import { useEffect, useRef, useState } from "react";
import type { MapMarker, MapProps } from "./mapTypes";
import { markerGrafik } from "./markerHtml";
import { loadGoogleMaps, beiGoogleMapsAblehnung, ABLEHNUNGS_HINWEIS } from "./googleMapsLoader";

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

  // Karte aufbauen (einmal) und auf Googles Ablehnung hoeren.
  useEffect(() => {
    let abgebrochen = false;
    const abmelden = beiGoogleMapsAblehnung(() => {
      setFehler(ABLEHNUNGS_HINWEIS);
      setBereit(false);
    });
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
    return () => { abgebrochen = true; abmelden(); };
    // Nur beim Aufbau - center/zoom werden danach ueber fit/follow gesteuert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marker abgleichen.
  useEffect(() => {
    const map = mapRef.current;
    if (!bereit || !map || fehler) return;
    try {
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
        // Advanced Markers sind DOM-Elemente: Klick kommt als "gmp-click".
        if (am.__klick) am.removeEventListener("gmp-click", am.__klick);
        am.__klick = () => {
          m.onClick?.();
          if (m.popup || m.label) {
            infoRef.current = infoRef.current ?? new g.maps.InfoWindow();
            infoRef.current.setContent(m.popup ?? m.label ?? "");
            infoRef.current.open({ map, anchor: am });
          }
        };
        am.addEventListener("gmp-click", am.__klick);
      }
      for (const [id, am] of markerRef.current) {
        if (!gesehen.has(id)) {
          if (am.__klick) am.removeEventListener("gmp-click", am.__klick);
          am.map = null;
          markerRef.current.delete(id);
        }
      }
    } catch (e: any) {
      console.error("Google Maps (Marker):", e?.message ?? e);
    }
  }, [markers, bereit, fehler]);

  // Streckenverlauf: dunkler Rand, gelbe Linie.
  useEffect(() => {
    const map = mapRef.current;
    if (!bereit || !map || fehler) return;
    try {
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
    } catch (e: any) {
      console.error("Google Maps (Strecke):", e?.message ?? e);
    }
  }, [line, bereit, fehler]);

  // Einmaliges Einpassen.
  useEffect(() => {
    const map = mapRef.current;
    if (!bereit || !map || fehler || eingepasst.current) return;
    try {
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
    } catch (e: any) {
      console.error("Google Maps (Einpassen):", e?.message ?? e);
    }
  }, [bereit, fehler, markers, fit, center]);

  // Folgen, bis der Nutzer eingreift.
  useEffect(() => {
    const map = mapRef.current;
    if (!bereit || !map || fehler || !follow || nutzerHatEingegriffen.current) return;
    try {
      map.panTo({ lat: center[0], lng: center[1] });
    } catch {
      /* nach einer Ablehnung wirft Google - dann ist ohnehin fehler gesetzt */
    }
  }, [center, follow, bereit, fehler]);

  return (
    <div className={className ?? "h-full w-full"}>
      {fehler ? (
        <div
          className="flex h-full w-full items-center justify-center rounded-xl bg-ink-50 p-4 text-center text-sm text-ink-500"
          role="alert"
          data-testid="google-map-error"
        >
          {fehler}
        </div>
      ) : (
        <div ref={divRef} className="h-full w-full" data-testid="google-map" />
      )}
    </div>
  );
}
