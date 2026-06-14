# TaxiOS – Test Credentials

## Super-Admin
- URL: `/admin/login`
- E-Mail: `super@taxios.app`
- Passwort: `SuperAdmin2026!`
- Erreicht: `/super-admin` Overview aller registrierten Firmen.

## Firmen-Admin (selbst registrieren)
- URL: `/registrieren`
- Beim Registrieren wird automatisch ein Slug erzeugt: `/c/<slug>`.
- Anschließend ist man als Admin angemeldet und kann unter `/admin` Fahrer + Preise anlegen.

## Fahrer
- URL: `/fahrer/login`
- Werden vom Firmen-Admin unter `/admin/fahrer` angelegt (Username + Passwort wird beim Anlegen gesetzt).

## Kunden
- URL: `/c` (Kunden-Portal-Übersicht) oder direkt `/c/<firmen-slug>` bzw. `/c/<firmen-slug>/buchen`.
- Keine Anmeldung notwendig.
