"""Iteration 13 – echte Stripe-Kartenzahlung (PaymentIntent-Vorbereitung).

Ohne STRIPE_SECRET_KEY läuft alles im Mock: /api/payments/intent liefert
mock=true + clientSecret=null, und eine CARD-Buchung wird weiterhin serverseitig
(mock) autorisiert (siehe test_phase2 ...). Der echte Stripe-Pfad (Elements +
client_secret + Webhook) ist nur mit Test-Keys end-to-end prüfbar.
"""
import os
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://taxios-dispatch.preview.emergentagent.com"
).rstrip("/")

HBF = {"lat": 52.3759, "lng": 9.7320}
KROEPCKE = {"lat": 52.3719, "lng": 9.7385}


class TestPaymentIntent:
    def test_intent_mock_when_no_key(self):
        r = requests.post(f"{BASE_URL}/api/payments/intent", json={"pickup": HBF, "dest": KROEPCKE}, timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        d = r.json()
        # Ohne Key: Mock-Modus, kein clientSecret, aber serverseitig berechneter Betrag.
        assert d.get("mock") is True
        assert d.get("enabled") is False
        assert d.get("clientSecret") in (None, "")
        assert (d.get("amount") or 0) > 0  # Cent
        assert (d.get("priceMax") or 0) > 0

    def test_intent_with_stops_amount_increases(self):
        direct = requests.post(f"{BASE_URL}/api/payments/intent", json={"pickup": HBF, "dest": KROEPCKE}, timeout=20).json()
        via = requests.post(
            f"{BASE_URL}/api/payments/intent",
            json={"pickup": HBF, "dest": KROEPCKE, "stops": [{"lat": 52.40, "lng": 9.80}]},
            timeout=20,
        ).json()
        assert via["amount"] >= direct["amount"]

    def test_intent_bad_payload(self):
        r = requests.post(f"{BASE_URL}/api/payments/intent", json={"pickup": HBF}, timeout=15)
        assert r.status_code == 400


class TestWebhookGuarded:
    def test_webhook_without_secret_or_sig_rejected(self):
        # Ohne STRIPE_WEBHOOK_SECRET/Signatur -> kein 200 (503 not configured bzw. 400).
        r = requests.post(f"{BASE_URL}/api/payments/webhook", data="{}", timeout=15)
        assert r.status_code in (400, 503), f"unexpected {r.status_code}"
