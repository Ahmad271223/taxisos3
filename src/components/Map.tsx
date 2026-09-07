"use client";

// Die Karte der Anwendung: Google Maps. Alle Aufrufer sprechen nur mit dieser
// Datei und den Typen aus mapTypes.ts.
//
// Ohne Browser-Schluessel (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) gibt es keine
// Karte - dann steht an ihrer Stelle ein klarer Hinweis statt einer leeren
// Flaeche, damit die Ursache sofort erkennbar ist. Die Startsperre verhindert
// im Echtbetrieb, dass es ueberhaupt so weit kommt.

import type { MapProps } from "./mapTypes";
import { googleMapsAktiv } from "./googleMapsLoader";
import GoogleMap from "./GoogleMap";

export type { MapMarker, MapProps } from "./mapTypes";

export function KarteNichtKonfiguriert({ className }: { className?: string }) {
  return (
    <div
      className={`${className ?? "h-full w-full"} flex items-center justify-center rounded-xl bg-ink-50 p-4 text-center text-sm text-ink-500`}
      data-testid="map-unconfigured"
    >
      Karte nicht verfügbar – Google-Maps-Schlüssel fehlt (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).
    </div>
  );
}

export default function Map(props: MapProps) {
  if (!googleMapsAktiv()) return <KarteNichtKonfiguriert className={props.className} />;
  return <GoogleMap {...props} />;
}
