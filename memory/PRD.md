# TaxiOS – PRD (Living Doc)

## Problem Statement (verbatim, gekürzt)
- .env-Werte ergänzen (inkl. `SEARCH_MAX_MS=180000`)
- Kunden-Dashboard & Buchung Uber-freundlicher gestalten (Live-Karte, Auftragsvergabe),
  aktuellen Farbstil (Yellow/Ink) beibehalten
- Live-Karte: nur online + frei = grün, klickbar → Kennzeichen, Sitzplätze, Typ, Name,
  Gepäck, direkt buchen

## Stack
- Next.js 14 (App Router) + tsx server (Express + Socket.IO)
- Prisma + PostgreSQL
- Tailwind (Yellow brand-500 / Ink palette)
- Leaflet/react-leaflet (LocationIQ Tiles)
- Stripe (Test-Keys), Twilio (SMS), Resend (Email)

## Implementiert in dieser Session (Jan 2026)
- `.env` neu erstellt mit allen Werten aus Problem Statement + `SEARCH_MAX_MS=180000`,
  `ENABLE_SIMULATOR=0`, LocationIQ Tile-URL, Stripe Test-Keys
- `LiveTaxiMap.tsx` komplett im Uber-Stil neugebaut:
  - Vollbild-Hintergrund-Karte
  - Schwebende Top-Bar (Zurück / "X frei · Y besetzt" Live-Pill / Konto-Avatar)
  - "Wohin?"-Such-Pille direkt unter Top-Bar → führt zu `/buchen?to=...`
  - Bottom-Sheet mit Begrüßung (eingeloggte Kunden), Schnellaktionen
    (Sofort / Später / Flughafen / Gruppe) + "Taxi bestellen"-CTA
  - Beim Tippen auf ein Auto: Detail-Bottom-Sheet mit
    Fahrzeug, Kennzeichen, Sitzplätze, Gepäck, Fahrer-Name, Firma, Status
  - "Dieses Taxi bestellen" → `/buchen?class=...&driver=...` (gezielte Bestellung)
- `CustomerAccount.tsx`: neuer "Wohin?"-Hero über den Tabs:
  - Mini-Live-Karte (160 px) mit Auto-Refresh alle 8 s
  - "X frei"-Live-Pill, Vollbild-Karte-Link
  - "Wohin?"-Eingabefeld → `/buchen?to=...`
- `BookingForm.tsx`: akzeptiert `initialDestination` (Pre-Fill via `?to=` Param)
- `/buchen/page.tsx`: reicht `searchParams.to` an `BookingForm` weiter,
  Hero-Headline "Wohin geht's?"

## Files Touched
- /app/.env (neu)
- /app/src/components/LiveTaxiMap.tsx (rewrite, Uber-Style)
- /app/src/components/CustomerAccount.tsx (+ WhereToHero, Mini-Map)
- /app/src/components/BookingForm.tsx (+ initialDestination prop)
- /app/src/app/buchen/page.tsx (Hero-Headline, to-Param)

## Farbpalette (unverändert)
- Brand: `brand-500` = #FFC400 (Gelb)
- Ink: grayscale (text-ink-900 etc.)
- Akzente: green-500 (frei), red-600 (Fehler)

## Bekannte/Mocked
- TWILIO_FROM leer → SMS im Mock-Modus (devCode wird in UI angezeigt)
- RESEND_API_KEY leer → Mail im Mock-Modus
- Stripe Test-Keys: echte Authorize-then-Capture möglich

## Backlog / Nice-to-Have
- P1: Live-Karte: Auto-Marker bewegen sich smooth (CSS transition statt Re-Render)
- P1: "Wohin?"-Suche mit Autocomplete (geocode-API ist vorhanden)
- P2: Kundenkonto-Hero merkt sich letzte Ziele als Vorschläge
- P2: Bottom-Sheet schwenkbar (Drag-Indikator existiert visuell)

## Next Actions
- Lokal `yarn install && yarn dev` → Live-Karte unter `/taxis` und Konto unter `/konto`
  prüfen
- Falls SMS produktiv: `TWILIO_FROM` mit verifizierter Nummer setzen
