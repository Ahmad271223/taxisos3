# TaxiOS – Product Requirements Document

## Original Problem Statement
Multi-Tenant Taxi-Dispatch-Plattform für die DACH-Region. Taxiunternehmen registrieren
sich, legen Fahrer an, Fahrer gehen online/offline. Kunden bestellen **ohne Firma
auszuwählen** – die Plattform vermittelt firmen­übergreifend den nächsten freien
Fahrer per GPS-Radius-Dispatch.

## Architektur
- **Frontend**: Next.js 14 (App Router) + Tailwind + Leaflet (Karte)
- **Backend**: Next.js Custom Server (Node.js) mit Socket.IO Realtime + Prisma + SQLite
- **Realtime**: socket.io – Räume `driver:<id>`, `booking:<id>`, `admins:<companyId>`, `drivers`
- **Dispatch-Engine**: `src/server/dispatch.ts` – Radius-basierter Bolt-Style-Matcher (firmen­übergreifend)
- **Pricing**: Plattform-Default-Tarif aus `/app/.env` (TARIFF_BASE/PER_KM/PER_MIN); Firmen­spezifischer Tarif optional.

## Personas
1. **Kunde** – bestellt anonym (kein Account) über `/buchen` oder `/buchen/vorbestellung`.
2. **Fahrer** – Login per Username/Passwort, geht online/offline, akzeptiert Angebote.
3. **Firmen-Admin** – verwaltet Fahrer, Tarife, sieht eigene Buchungen.
4. **Super-Admin** – sieht alle Firmen plattform­weit (`/super-admin`).

## Static Core Requirements
- Kunden bestellen direkt, ohne Firma aus­zuwählen.
- Radius-Dispatch: 500 m → 1 km → 2 km → 3 km → 5 km, 15 s pro Phase.
- Alle FREI-Fahrer im aktuellen Radius bekommen das Angebot gleichzeitig; wer zuerst annimmt, gewinnt.
- Fahrer mit aktiver Fahrt, deren Position < 300 m vom Ziel ist ("near completion"), sind wieder eligible.
- Booking.companyId ist **nullable** und wird erst beim Akzeptieren auf die Firma des annehmenden Fahrers gesetzt.
- Live-GPS-Tracking pro Fahrt unter `/verfolgen/<id>` (öffentlich, ohne Login).

## What's been implemented
### 2026-01 (iteration 5/6 – v2.0 Phase 1: Provision + RESERVED + Stornos + Festpreis)
- **a) Plattform-Provision**: Company.cityTier (BIG=7 %, SMALL=5 %). Bei `tripAction("complete")` werden `platformFeeRate`, `platformFee`, `companyNet` automatisch berechnet und persistiert. Super-Admin Dashboard zeigt `platform-financials` (Brutto / Provision / Auszahlung / Fahrten) + Firmen-Tabelle mit Tier-Badge. Admin Dashboard hat neue `commission-card` (Tarif­stufe, Provision heute, Provision Monat, Netto-Auszahlung Monat).
- **b) ONLINE_RESERVED_NEXT_TRIP**: Neuer Driver-Status `RESERVIERT`. BESETZT-Fahrer < 300 m vom Ziel werden in `driverNearCompletion` markiert; nehmen sie ein neues Angebot an, geht ihre aktuelle Fahrt weiter, der neue Auftrag wird mit `trackingStatus="RESERVIERT_FAHRER"` und `isReserved=true` reserviert. Nach `complete` der aktuellen Fahrt wird die reservierte Fahrt automatisch auf `FAHRER_UNTERWEGS` promotet. Kunde sieht im Banner: „Ihr Fahrer beendet aktuell noch eine andere Fahrt und kommt anschließend direkt zu Ihnen."
- **c) Stornierungs-Protokoll**: Neues Model `CancellationLog` (actorType, actorId, reason). 3 Endpoints: `POST /api/bookings/:id/cancel` (Kunde, gesperrt ab FAHRER_ANGEKOMMEN), `POST /api/admin/bookings/:id/cancel` (Admin, jederzeit, cross-company verboten), `GET /api/admin/bookings/:id/cancellations` (Log-Historie). Fahrer-Storno via socket → `dispatcher.tripAction("cancel")`. Reservierte Folgefahrt wird bei Fahrer-Storno automatisch in die Suche zurückgegeben. Tracking-View zeigt `cancel-booking`-Button für Kunden bis FAHRER_ANGEKOMMEN.
- **d) Exakter Festpreis nach Annahme**: `acceptBooking` berechnet route + pricing und persistiert `priceExact` (Mittelwert aus priceMin/priceMax-Korridor). Tracking-View zeigt vorher Preisschätzung-Spanne, nach Annahme Festpreis-Karte mit Bestätigungs-Hinweis. `final-fare` greift beim Abschluss auf `priceExact` zu.
- **Quick Wins**: GET `/api/bookings/:id` liefert flat + wrapped (Backward-Compat). hideLabel-Prop in AddressInput. RESERVIERT in TRACKING_STEPS + DRIVER_STATUS.

### 2026-01 (iteration 4 – Platform-Wide Refactor)
- Homepage komplett neu: 3 Kunden-CTAs (Jetzt bestellen / Später bestellen / Anrufen) – **keine** Firmen­auswahl mehr.
- Neue Top-Level-Routen `/buchen` und `/buchen/vorbestellung`.
- BookingForm akzeptiert optionalen `companySlug` – default ist Plattform­buchung.
- `POST /api/bookings` akzeptiert Body ohne `company` und verwendet Plattform-Default-Tarif.
- `prisma.Booking.companyId` ist jetzt `String?` (Migration: `prisma db push`).
- Dispatch-Engine komplett neu (`src/server/dispatch.ts`):
  - Radius-Erweiterung 500 m → 1 km → 2 km → 3 km → 5 km, 15 s pro Phase.
  - Broadcast an alle FREI-Fahrer im Phasenradius (firmen­übergreifend).
  - Erster Accept gewinnt → Booking erbt die Firma des Fahrers.
  - Near-Completion-Logik: Fahrer < 300 m vom aktuellen Ziel werden wieder eligible.
- AddressInput-Bugfix: kein `onChange(r.label)` mehr beim Auswählen → lat/lng bleiben erhalten.
- `hideLabel`-Prop für AddressInput (BookingForm rendert eigene Labels außen).
- Demo-Zugang-Hints aus `/admin/login` & `/fahrer/login` entfernt.

### 2026-01 (iteration 3)
- Driver-Portal mit GPS-Share-Karte (`gps-share-card`, `gps-share-toggle`).
- Backend-Regression-Tests `test_taxios_api.py` (15/15 green).
- Firmen-Registrierung `/registrieren` → automatischer Slug, sofortiger Admin-Login.

## Tests
- `/app/backend/tests/test_taxios_api.py` (15 Regression-Tests, grün)
- `/app/backend/tests/test_platform_booking.py` (5 Platform-Booking-Tests, grün)
- `/app/backend/tests/test_phase1_commission_cancel.py` (16 Phase-1 Tests, grün)
- **Total: 36/36 pytest grün, Frontend E2E iteration_6: 100 %.**
- `/app/test_reports/iteration_4.json` (E2E Plattform-Buchung)
- `/app/test_reports/iteration_5.json` + `/app/test_reports/iteration_6.json` (v2.0 Phase 1)

## Credentials
Siehe `/app/memory/test_credentials.md`.

## Prioritized Backlog
### Phase 2 (geplant)
- **e** Mehrziel-Vorabplanung (mehrere Stopps + Gesamtpreis vor Bestellung)
- **f** Zieländerung während der Fahrt (Zwischenstopp/neues Ziel, automatische Neuberechnung)
- **g** Stripe Authorize-then-Capture (Karte bei Bestellung autorisieren, nach Fahrtende belasten)

### Phase 3 (geplant)
- **h** SMS-/E-Mail-Verifizierung für Gast­bestellungen (Twilio bzw. Resend – Provider noch zu wählen)
- **i** Temporärer Live-Chat Kunde ↔ Fahrer (Socket.IO)
- **j** Backlog: NEXT_PUBLIC_PLATFORM_PHONE setzen, E2E mit 2+ parallelen Fahrer-Browser-Contexten

### P2 – Future
- Push-Benachrichtigungen für Fahrer (Web Push) statt nur Socket.IO-Events.
- Heatmap-Layer in der Admin-Karte (Live-Nachfrage).
- Fahrer-Bewertungssystem ausbauen (aktuell vorhanden, aber im Admin-UI minimal).
- Mehrere Tarif-Profile pro Firma (Tag/Nacht/Festpreis-Korridore).

## Next Action Items
- Cross-Company-Dispatch live mit 2+ Fahrer-Browser-Contexten testen (P1).
- Plattform-Telefon `NEXT_PUBLIC_PLATFORM_PHONE` in `.env` setzen → "Anrufen"-CTA wird automatisch sichtbar.
