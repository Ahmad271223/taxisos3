import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Manrope } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { CookieNotice } from "@/components/CookieNotice";

const display = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700", "800"],
});

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

// Diese App läuft auf einem Custom-Server (Express + Socket.IO) und ist komplett
// dynamisch (API-Routen, Live-Daten). Statisches Prerendering bringt keinen
// Nutzen und scheitert an client-only Komponenten -> app-weit dynamisch rendern.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "TaxiOS – Smarte Taxi-Vermittlung",
  description:
    "Moderne Taxi-Plattform für Unternehmen: GPS-Auto-Dispatch, Live-Tracking, flexible Tarife. Für Fahrer und Kunden – komplett im Browser.",
  // PWA: auf dem Handy installierbar, Start im Vollbild (iOS).
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TaxiOS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFC400",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${sans.variable} ${display.variable}`}>
      <body className="font-sans">
        {children}
        <CookieNotice />
      </body>
    </html>
  );
}
