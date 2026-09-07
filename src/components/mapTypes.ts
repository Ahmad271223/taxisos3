// Gemeinsame Schnittstelle aller Kartendarstellungen (Leaflet und Google).
// Wer eine Karte einbindet, spricht nur mit diesen Typen - welcher Anbieter
// dahinter zeichnet, entscheidet Map.tsx anhand der Umgebung.

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

export interface MapProps {
  center: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  line?: [number, number][];
  /** Beim ersten Aufbau auf alle Marker zoomen. Danach bleibt die Ansicht, wie der Nutzer sie laesst. */
  fit?: boolean;
  className?: string;
  /** Der Karte folgt `center`, bis der Nutzer selbst schiebt oder zoomt. */
  follow?: boolean;
}
