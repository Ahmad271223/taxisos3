"""Iteration 25 – SOS-Notfall-Dispatch: SOS mit Standort legt automatisch eine
Notfall-Rettungsfahrt an. (Die automatische Fahrerzuweisung bei vorhandenem
freien Fahrer prüft scripts/e2e_sos_dispatch.js.)
"""
import os
import time
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://5edd2c00-4649-42ac-89e2-a6ce5e73bc02.preview.emergentagent.com"
).rstrip("/")


def _verify_token(phone: str):
    rq = requests.post(f"{BASE_URL}/api/verify/request", json={"channel": "SMS", "target": phone}, timeout=15)
    code = rq.json().get("devCode")
    if not code:
        return None
    rc = requests.post(f"{BASE_URL}/api/verify/confirm", json={"channel": "SMS", "target": phone, "code": code}, timeout=15)
    return rc.json().get("token")


class TestSosDispatch:
    def test_sos_with_location_creates_rescue_booking(self):
        ts = int(time.time() * 1000)
        phone = f"0196{ts % 10_000_000:07d}"
        s = requests.Session()
        s.post(
            f"{BASE_URL}/api/customer/register",
            json={"name": "SOS HTTP", "email": f"soshttp+{ts}@test.com", "phone": phone, "password": "Pass1234", "verificationToken": _verify_token(phone)},
            timeout=20,
        )
        r = s.post(f"{BASE_URL}/api/sos", json={"lat": 52.3801, "lng": 9.7400, "message": "Test"}, timeout=20)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["ok"] is True
        # Mit Standort wird eine Rettungsfahrt erzeugt (Fahrer ggf. später per Sweep).
        assert body.get("rescueBookingId"), body
        # Die erzeugte Buchung ist eine SOS-Fahrt am Notfallstandort.
        bid = body["rescueBookingId"]
        gb = requests.get(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
        assert gb.status_code == 200, gb.text
        b = gb.json().get("booking") or gb.json()
        assert b.get("isSos") is True, b
        assert abs(b["pickupLat"] - 52.3801) < 0.001 and abs(b["pickupLng"] - 9.7400) < 0.001

    def test_sos_without_location_no_rescue(self):
        ts = int(time.time() * 1000) + 1
        phone = f"0197{ts % 10_000_000:07d}"
        s = requests.Session()
        s.post(
            f"{BASE_URL}/api/customer/register",
            json={"name": "SOS NoLoc", "email": f"sosnoloc+{ts}@test.com", "phone": phone, "password": "Pass1234", "verificationToken": _verify_token(phone)},
            timeout=20,
        )
        r = s.post(f"{BASE_URL}/api/sos", json={"message": "ohne Standort"}, timeout=20)
        assert r.status_code == 201, r.text
        # Ohne Standort keine automatische Rettungsfahrt – aber Meldung existiert.
        assert r.json().get("rescueBookingId") in (None, "")
        assert r.json().get("ok") is True
