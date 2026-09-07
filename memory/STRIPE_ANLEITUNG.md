# Stripe einrichten — Schritt für Schritt

Stand: 07.09.2026. Gilt für TaxiOS auf Render (`https://taxisos3.onrender.com`),
später unter `altstadttaxi-hannover.de`.

---

## 0. Was TaxiOS mit Stripe macht

Es gibt **drei getrennte Geldflüsse**. Wer die auseinanderhält, versteht jeden
weiteren Schritt:

| Geldfluss | Von → An | Wie |
|---|---|---|
| **Fahrpreis + Trinkgeld** | Fahrgast → Taxiunternehmen | Destination-Charge über dein Plattform-Konto, **0 % Provision** |
| **Monatliches Abo** | Taxiunternehmen → dich | Stripe-Abo (Karte oder SEPA-Lastschrift) |
| **Barfahrten** | Fahrgast → Fahrer im Wagen | berührt Stripe **nie** |

Wichtig: Du bist die **Plattform**. Jedes Taxiunternehmen bekommt ein eigenes
Stripe-Konto (Connect Express), das an deines angehängt ist. Das Geld der
Fahrgäste geht durch deine Anbindung hindurch direkt auf das Firmenkonto — es
liegt nie bei dir und du haftest nicht dafür.

Kartendaten sieht weder dein Server noch die Firma: Der Fahrgast gibt sie auf
einer von Stripe gehosteten Seite ein. Deshalb brauchst du auch **keinen
öffentlichen Stripe-Schlüssel** (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`).

---

## 1. Test- oder Echtbetrieb?

Stripe hat zwei komplett getrennte Welten mit **eigenen Schlüsseln, eigenen
Webhooks, eigenen Connect-Konten**:

- **Testmodus** (`sk_test_…`): alles funktioniert, es fließt kein echtes Geld.
- **Echtbetrieb** (`sk_live_…`): erst nach Freischaltung deines Kontos möglich.

**Mach zuerst alles im Testmodus.** Wenn es dort läuft, wiederholst du die
Schritte 3–5 im Echtbetrieb — es ist dieselbe Klickstrecke, nur mit dem
Schalter oben rechts auf „Live".

Aktuell steht in deiner `.env` ein `sk_test_…`-Schlüssel.

---

## 2. Connect aktivieren (einmalig)

Ohne diesen Schritt kann **kein Taxiunternehmen ein Auszahlungskonto
hinterlegen** — alle Kartenzahlungen lägen auf deinem Plattform-Konto und
müssten von Hand überwiesen werden.

1. Stripe-Dashboard → linke Leiste **Connect** → *Erste Schritte*.
2. Plattform-Typ: **Plattform oder Marktplatz**.
3. Kontotyp: **Express**. (Nicht Standard, nicht Custom — Express bedeutet:
   Stripe übernimmt Identitätsprüfung und Support für die Firmen, du nicht.)
4. Land der verbundenen Konten: **Deutschland**.
5. Bei der Frage, wer die Stripe-Gebühren trägt: **die Plattform** (du), denn
   die App zieht keine Provision ab.
6. Branding hinterlegen (Name, Logo, Farbe) — das sehen die Firmen während
   des Onboardings.

Prüfen: Unter *Connect → Konten* muss die Liste erscheinen (noch leer).

---

## 3. Schlüssel holen

Dashboard → **Entwickler → API-Schlüssel**.

- **Geheimer Schlüssel** (`sk_test_…` bzw. `sk_live_…`) → das ist
  `STRIPE_SECRET_KEY`.
- Den *veröffentlichbaren* Schlüssel brauchst du **nicht**.

> Der geheime Schlüssel ist ein Passwort für dein Geld. Nie in Git, nie in
> einen Screenshot, nie in einen Chat. Im Echtbetrieb zeigt Stripe ihn nur
> **einmal** — sofort in Render eintragen.

---

## 4. Webhook einrichten

Über den Webhook erfährt die App, was bei Stripe passiert ist. **Ohne ihn
startet die App im Echtbetrieb gar nicht** (bewusste Sperre), und es fehlen
genau die Meldungen, die den Betrieb tragen.

1. Dashboard → **Entwickler → Webhooks** → *Endpunkt hinzufügen*.
2. **URL:**
   ```
   https://taxisos3.onrender.com/api/payments/webhook
   ```
   Später zusätzlich `https://altstadttaxi-hannover.de/api/payments/webhook`.
   Achtung: **nicht** `/api/stripe/webhook` — diesen Pfad gibt es nicht.
3. **Diese Ereignisse auswählen:**

   | Ereignis | Wofür |
   |---|---|
   | `account.updated` | **Das wichtigste.** Meldet, dass eine Firma ihre Stripe-Prüfung bestanden hat. Fehlt es, gilt jede Firma dauerhaft als nicht auszahlungsbereit und alle Kartenzahlungen bleiben auf deinem Konto liegen. |
   | `payment_intent.succeeded` | Fahrt ist bezahlt |
   | `payment_intent.payment_failed` | Karte abgelehnt — Zentrale sieht es |
   | `payment_intent.canceled` | Reservierung freigegeben |
   | `checkout.session.completed` | Abo direkt nach Abschluss aktivieren |
   | `customer.subscription.created` / `.updated` / `.deleted` | Abo-Status der Firma |
   | `invoice.paid` / `invoice.payment_failed` | Abo bezahlt bzw. überfällig |

4. Nach dem Anlegen beim Endpunkt auf **„Signing secret" → anzeigen** klicken.
   Der Wert beginnt mit `whsec_…` → das ist `STRIPE_WEBHOOK_SECRET`.

---

## 5. Werte bei Render eintragen

Render → Dienst `taxisos3` → **Environment** → *Add Environment Variable*:

```
STRIPE_SECRET_KEY=sk_test_…      (bzw. sk_live_… im Echtbetrieb)
STRIPE_WEBHOOK_SECRET=whsec_…
```

Nach dem Speichern startet der Dienst neu. **Kein neuer Build nötig** — beide
Werte werden erst beim Laufen gelesen. (Anders als der Google-Browser-
Schlüssel, der beim Bauen fest eingebacken wird.)

---

## 6. Testlauf

### 6a. Firma verbindet ihr Konto

1. Als Firma anmelden → **Dashboard → Auszahlung** (`/admin/auszahlung`).
2. *Auszahlungskonto einrichten* → Stripe führt durch das Onboarding.
3. Im **Testmodus** musst du nichts erfinden: Stripe bietet oben einen Knopf
   zum Vorausfüllen an. Test-IBAN, falls doch nötig:
   `DE89 3704 0044 0532 0130 00`.
4. Zurück in TaxiOS: Status muss auf **„Auszahlungen aktiv"** springen.
   Tut er das nicht sofort, ist meist der Webhook `account.updated` nicht
   eingerichtet — *Status aktualisieren* holt ihn dann von Hand.

### 6b. Fahrgast zahlt

1. Als Fahrgast anmelden → **Konto → Zahlung** → Karte hinterlegen.
2. Testkarten:

   | Nummer | Verhalten |
   |---|---|
   | `4242 4242 4242 4242` | geht immer durch |
   | `4000 0025 0000 3155` | verlangt Bestätigung der Bank (3-D Secure) |
   | `4000 0000 0000 9995` | wird abgelehnt (keine Deckung) |

   Ablaufdatum: irgendein künftiges. Prüfziffer: irgendwelche drei Ziffern.
3. Fahrt mit **Kartenzahlung** buchen, durchführen, beenden.
4. Nach Fahrtende: Trinkgeld wählen (oder ablehnen) → Betrag wird abgebucht.
5. Prüfen in Stripe → *Zahlungen*: Der Vorgang muss **„An verbundenes Konto
   überwiesen"** ausweisen, empfangendes Konto = die Firma.

### 6c. Abo der Firma

Produkte und Preise legt die App selbst an (`taxios_p5_monthly` usw.) — im
Dashboard musst du dafür **nichts** pflegen. Firma → **Abo & Abrechnung** →
Tarif wählen → Stripe-Checkout mit Karte oder SEPA-Lastschrift.

> Falls SEPA nicht angeboten wird: Dashboard → *Einstellungen →
> Zahlungsmethoden* → SEPA-Lastschrift aktivieren.

---

## 7. Umstellung auf den Echtbetrieb

1. Stripe-Konto vollständig freischalten lassen (Gewerbe, Ausweis,
   Bankverbindung, Steuerdaten).
2. Schalter oben rechts auf **Live**.
3. **Schritte 2, 3 und 4 im Live-Modus wiederholen** — Connect, Schlüssel und
   Webhook sind je Modus eigenständig. Ein Testmodus-Webhook meldet im
   Echtbetrieb nichts.
4. Bei Render `STRIPE_SECRET_KEY` und `STRIPE_WEBHOOK_SECRET` auf die
   Live-Werte ändern.
5. **`ALLOW_TEST_MODE_IN_PRODUCTION` bei Render löschen.** Solange die Variable
   steht, startet die App auch mit fehlenden oder falschen Schlüsseln.
6. Jede Firma muss ihr Auszahlungskonto **erneut** verbinden — Testkonten
   gelten im Echtbetrieb nicht.

---

## 8. Kosten

Zahlen ändern sich; maßgeblich ist stripe.com/de/pricing. Größenordnung heute:

- **Karte, europäisch:** rund 1,5 % + 0,25 € je Zahlung.
- **Karte, außereuropäisch:** deutlich mehr (etwa 3,25 % + 0,25 €).
- **SEPA-Lastschrift:** günstiger als Karte, aber langsamer.
- **Connect Express:** rund 2 € je Monat und **aktivem** Firmenkonto.
- **Auszahlung** auf das Bankkonto der Firma: in der Regel enthalten.

Die App zieht **keine** Provision ab. Die Stripe-Gebühr der Fahrt trägt deine
Plattform — sie ist also in deiner Abo-Kalkulation einzupreisen.

---

## 9. Wenn etwas nicht geht

| Symptom | Ursache | Abhilfe |
|---|---|---|
| App startet bei Render nicht, Log nennt `STRIPE_WEBHOOK_SECRET` | Webhook-Geheimnis fehlt | Schritt 4 + 5 |
| Firma steht ewig auf „In Prüfung" | `account.updated` nicht abonniert | Ereignis nachtragen, dann *Status aktualisieren* |
| Zahlung landet auf dem Plattform-Konto statt bei der Firma | Firma nicht freigeschaltet | `/admin/auszahlung` prüfen — bei „nein/nein" fehlen Angaben |
| „Die Zahlungsanbindung ist nicht verfügbar" | `STRIPE_SECRET_KEY` fehlt oder falsch | Schlüssel prüfen, Modus (test/live) vergleichen |
| Webhook meldet 400 in Stripe | falsches Geheimnis oder falscher Modus | Signing secret des **richtigen** Endpunkts kopieren |
| Zahlung schlägt sporadisch mit „connection to Stripe" fehl | Netzstörung | behoben: bis zu drei Wiederholungen, idempotent |

Belege im Code: `src/lib/stripe.ts` (alle Stripe-Aufrufe),
`src/lib/settle.ts` (Abrechnung nach der Fahrt),
`src/app/api/payments/webhook/route.ts` (Ereignisse),
`src/app/api/admin/connect/route.ts` + `src/components/AdminPayout.tsx`
(Auszahlungskonto), `src/lib/subscription.ts` (Abo).
