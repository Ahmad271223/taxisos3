# TaxiOS – PRD (Living Doc)

## Problem Statement (verbatim, gekürzt)
- .env mit allen Werten + `SEARCH_MAX_MS=180000`
- Kunden-UI Uber-style **aber seriöser**, **keine KI-Emojis**, Farbstil Yellow/Ink beibehalten
- Live-Karte mit freien Taxis, Klick auf Auto zeigt Details (Kennzeichen, Sitze, Typ, Name, Gepäck) → direkt buchen
- **ETA-Schätzung** an mehreren Stellen (Live-Karte + Fahrzeugauswahl)

## Stack
- Next.js 14 + tsx Custom-Server (Express + Socket.IO)
- Prisma + PostgreSQL 15 (lokal installiert + geseedet)
- Tailwind (Brand-Gelb #FFC400 + Ink-Grau)
- Leaflet/react-leaflet, LocationIQ Tiles
- FastAPI Proxy (Port 8001 → Next.js Port 3000)

## Implementiert in dieser Session (Jan 2026)

### Iteration 1 – Basis Uber-Layout + .env
- `.env` mit allen Werten aus Problem Statement + `SEARCH_MAX_MS=180000`, echtem 32-Byte AUTH_SECRET
- LiveTaxiMap im Uber-Vollbild-Stil mit Top-Bar, „Wohin?"-Pille, Bottom-Sheet
- CustomerAccount mit „Wohin?"-Hero + Mini-Live-Karte
- BookingForm mit `?to=` Param-Vorausfüllung
- PostgreSQL installiert, DB+Seed, 6 Demo-Fahrer angelegt
- App läuft via Supervisor (Frontend Port 3000, Backend-Proxy Port 8001)

### Iteration 2 – Seriös + ETA (aktuell)
- **Neue Datei `/app/src/components/VehicleIcon.tsx`**: 9 maßgeschneiderte SVG-Auto-Silhouetten (Standard, Van, Extra-Gepäck, Shuttle, Business, Wheelchair, Pet, Child-Seat, VIP) statt Emoji
- **LiveTaxiMap**:
  - Alle Emojis durch klare SVG-Icons ersetzt (GPS-Pin, Uhr, Personen, Gepäck, Kennzeichen, Schließen-X)
  - **ETA-Banner im Detail-Sheet**: dunkles „Ankunft bei Ihnen ~ X Min." Banner mit gelber Uhr (Haversine × 1.35 / 30 km/h)
  - **„Schnellster Wagen ca. X Min. bei Ihnen"** Pille unter der „Wohin?"-Eingabe
  - Browser-Geolocation lädt User-Position still, eigener Pickup-Marker auf der Karte
  - Status-Labels „verfügbar/besetzt" (statt „frei")
  - QuickTiles mit eigenen SVG-Icons (Uhr, Kalender, Flugzeug, Personen)
- **BookingForm VehicleClassPicker**:
  - Uber-Style große Karten mit **SVG-Auto-Silhouette pro Klasse**
  - Pro Klasse: Sitze, Gepäck, **ETA in grün**, Verfügbarkeitsstatus, Preis
  - Selektion-Indicator („gewählt"-Badge auf gewählter Klasse)
  - Live-ETA-Berechnung über `/api/taxis/live` + Haversine
- **BookingForm Preis-Karte**: schwarze Karte „VORAUSSICHTLICHER FAHRPREIS" mit gelber „Abholung ~ X Min."-Pille
- **buchen/page.tsx**: alle Emoji-CTAs durch klare SVG-Tiles mit Icon-Boxen ersetzt
- **CustomerAccount**: „Guten Tag, {Name}" statt „Hallo, {Name} 👋", Schnellaktionen mit SVG-Icons

## Files Touched (Iteration 2)
- /app/src/components/VehicleIcon.tsx (neu)
- /app/src/components/LiveTaxiMap.tsx (rewrite, SVG-Icons + ETA)
- /app/src/components/BookingForm.tsx (VehicleClassPicker, ETA, Preis-Karte)
- /app/src/app/buchen/page.tsx (rewrite, SVG-Tiles)
- /app/src/components/CustomerAccount.tsx (SVG-Schnellaktionen, kein Emoji)

## Demo-Setup
- 6 Fahrer in Hannover (Standard, Van, Business, Shuttle, Wheelchair, Extra-Gepäck)
- ENABLE_SIMULATOR=1 → Fahrer bewegen sich live + nehmen Aufträge an
- Test-Login: `anna@kunde.test` / `demo1234` (siehe `/app/memory/test_credentials.md`)

## Backlog / Next
- P1: Smooth Marker-Animation (CSS transition statt Re-Render)
- P1: Adress-Autocomplete in der „Wohin?"-Pille (LocationIQ-API ist eingebunden)
- P2: ETA-Genauigkeit via OSRM-Route statt Luftlinie (vorhanden, aktuell nur Luftlinie wegen Performance)
- P2: Letzte Ziele als Schnellzugriff im Konto

## Next Actions
- App ist live & getestet über die Preview-URL
- Optional: `TWILIO_FROM` setzen für echte SMS
