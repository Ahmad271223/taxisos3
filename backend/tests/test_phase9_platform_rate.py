"""Iteration 14 – „ca."-Vorabpreis aus dem täglichen Plattform-Durchschnitt.

Der Tageslauf (02:00) berechnet den Durchschnitts-km-Preis ALLER Firmen; daraus
entsteht der „ca."-Vorabpreis im Quote/Booking. Nach Fahrer-Annahme gilt der
exakte Firmentarif (priceExact, siehe Phase-1-Tests). Hier:
  - GET/POST /api/super/platform-rate (lesen/neu berechnen; Auth)
  - /api/quote liefert priceApprox; Booking speichert priceApprox
"""
import os
import time
import random
import string
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://taxios-dispatch.preview.emergentagent.com"
).rstrip("/")

SUPER_EMAIL = "super@taxios.app"
SUPER_PASS = "SuperAdmin2026!"
HBF = {"lat": 52.3759, "lng": 9.7320}
AIRPORT = {"lat": 52.4611, "lng": 9.6850}


def _rand(n=4):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _super():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PASS, "role": "ADMIN"}, timeout=20)
    assert r.status_code == 200
    return s


def _verified_token(phone):
    rq = requests.post(f"{BASE_URL}/api/verify/request", json={"channel": "SMS", "target": phone}, timeout=15).json()
    code = rq.get("devCode")
    rc = requests.post(f"{BASE_URL}/api/verify/confirm", json={"channel": "SMS", "target": phone, "code": code}, timeout=15).json()
    return rc.get("token")


class TestPlatformRateEndpoint:
    def test_requires_super(self):
        assert requests.get(f"{BASE_URL}/api/super/platform-rate", timeout=15).status_code == 401

    def test_get_and_recompute_shape(self):
        s = _super()
        # neu berechnen
        r = s.post(f"{BASE_URL}/api/super/platform-rate", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        rate = r.json()["rate"]
        for k in ("avgBasePrice", "avgPerKm", "avgPerMinute", "companyCount", "computedAt"):
            assert k in rate, f"missing {k}"
        assert rate["avgPerKm"] > 0
        # lesen liefert denselben Wert
        g = s.get(f"{BASE_URL}/api/super/platform-rate", timeout=15).json()["rate"]
        assert g["avgPerKm"] == rate["avgPerKm"]


class TestQuoteApprox:
    def test_quote_has_price_approx(self):
        r = requests.post(f"{BASE_URL}/api/quote", json={"from": HBF, "to": AIRPORT}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert (d.get("priceApprox") or 0) > 0, f"kein priceApprox: {d}"
        assert (d.get("approxPerKm") or 0) > 0
        # plausibel: ca. = Basis + perKm*km, grob in der Nähe der Mid-Schätzung
        assert d["priceApprox"] >= 0

    def test_approx_matches_platform_rate_times_km(self):
        s = _super()
        rate = s.post(f"{BASE_URL}/api/super/platform-rate", timeout=30).json()["rate"]
        d = requests.post(f"{BASE_URL}/api/quote", json={"from": HBF, "to": AIRPORT}, timeout=20).json()
        km = d["distanceMeters"] / 1000.0
        mn = d["durationSeconds"] / 60.0
        expected = round(rate["avgBasePrice"] + km * rate["avgPerKm"] + mn * rate["avgPerMinute"], 2)
        assert abs(d["priceApprox"] - expected) < 0.05, f"approx {d['priceApprox']} != erwartet {expected}"


class TestBookingStoresApprox:
    def test_booking_persists_price_approx(self):
        phone = "0511" + str(random.randint(100000, 999999))
        tok = _verified_token(phone)
        payload = {
            "customerName": f"TEST_{_rand()}",
            "customerPhone": phone,
            "pickupAddress": "HBF Hannover",
            "pickup": HBF,
            "destAddress": "Flughafen",
            "dest": AIRPORT,
            "paymentMethod": "CASH",
            "verificationToken": tok,
        }
        r = requests.post(f"{BASE_URL}/api/bookings", json=payload, timeout=25)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:200]}"
        b = r.json().get("booking", r.json())
        assert "priceApprox" in b
        assert (b.get("priceApprox") or 0) > 0, f"priceApprox nicht gesetzt: {b.get('priceApprox')}"
