# TaxiOS – Test-Zugänge

## Kunden-Konto (Demo)
- **E-Mail:** anna@kunde.test
- **Passwort:** demo1234
- **Telefon:** +491701234555 (bereits SMS-bestätigt)
- Login: `/konto`

## Super-Admin
- **E-Mail:** super@taxios.app
- **Passwort:** SuperAdmin2026!

## Demo-Firma + Fahrer
- **Firma:** CityTaxi Hannover (`/c/citytaxi-hannover`)
- **Firma Login E-Mail:** demo@citytaxi.test
- **Passwort:** demo1234

### Fahrer (Login: `/fahrer/login`, Passwort jeweils `demo1234`)
| User | Name | Kennzeichen | Klasse |
|---|---|---|---|
| murat | Murat Yilmaz | H-MY 1234 | STANDARD |
| ahmed | Ahmed Khan | H-AK 4521 | VAN |
| sara | Sara Becker | H-SB 7788 | BUSINESS |
| kemal | Kemal Demir | H-KD 0099 | SHUTTLE |
| lisa | Lisa Hoffmann | H-LH 2233 | WHEELCHAIR |
| tom | Tom Müller | H-TM 5567 | EXTRA_LUGGAGE |

## SMS-Verifizierung
TWILIO_FROM ist leer → **Mock-Modus**. Beim Anfordern des SMS-Codes wird der
6-stellige `devCode` direkt in der UI angezeigt (gelbe Info-Box „Testmodus – Code: …").
