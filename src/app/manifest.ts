import type { MetadataRoute } from "next";

// PWA-Manifest (Phase 12): macht die Web-App auf dem Handy installierbar
// ("Zum Startbildschirm hinzufügen") und startet im Vollbild (standalone).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TaxiOS – Taxi-Vermittlung",
    short_name: "TaxiOS",
    description: "Taxi live auf der Karte sehen, Fahrzeug wählen und direkt buchen.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F7F7F8",
    theme_color: "#FFC400",
    icons: [
      { src: "/logo.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/logo.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
