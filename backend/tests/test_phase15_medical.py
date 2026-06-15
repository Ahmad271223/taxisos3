"""Iteration 23 – Krankenfahrten + Wiederkehrend: einmalige Krankenfahrt mit
Kategorie/Fahrzeugklasse, ungültige Kategorie -> null, wiederkehrende Serie
(Login nötig) materialisiert Buchungen, Rückfahrt erzeugt Gegenrichtung,
Listing + Beenden storniert künftige Fahrten.
"""
import os
import time
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://taxios-dispatch.preview.emergentagent.com"
).rstrip("/")

HOME = {"lat": 52.3759, "lng": 9.7320}
CENTER = {"lat": 52.3719, "lng": 9.7385}
ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]


def _verify_token(phone: str):
    rq = requests.post(f"{BASE_URL}/api/verify/request", json={"channel": "SMS", "target": phone}, timeout=15)
    code = rq.json().get("devCode")
    if not code:
        return None
    rc = requests.post(f"{BASE_URL}/api/verify/confirm", json={"channel": "SMS", "target": phone, "code": code}, timeout=15)
    return rc.json().get("token")


def _account(ts):
    """Registriert ein Kundenkonto und gibt die Session zurück."""
    email = f"med+{ts}@test.com"
    phone = f"0181{ts % 10_000_000:07d}"
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/customer/register",
        json={"name": "Med Kunde", "email": email, "phone": phone, "password": "Pass1234", "verificationToken": _verify_token(phone)},
        timeout=20,
    )
    assert r.status_code in (200, 201), r.text
    return s, phone


class TestMedicalRides:
    def test_single_medical_stores_type(self):
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={
                "customerName": "TEST_Med",
                "customerPhone": f"0182{int(time.time()*1000) % 10_000_000:07d}",
                "pickupAddress": "Zuhause",
                "pickup": HOME,
                "destAddress": "Dialysezentrum",
                "dest": CENTER,
                "vehicleClass": "WHEELCHAIR",
                "medicalType": "DIALYSE",
            },
            timeout=25,
        )
        assert r.status_code == 201, r.text
        b = r.json()["booking"]
        assert b["medicalType"] == "DIALYSE"
        assert b["vehicleClass"] == "WHEELCHAIR"

    def test_invalid_medical_type_nulled(self):
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={
                "customerName": "TEST_MedBad",
                "customerPhone": f"0183{int(time.time()*1000) % 10_000_000:07d}",
                "pickupAddress": "Zuhause",
                "pickup": HOME,
                "destAddress": "Klinik",
                "dest": CENTER,
                "medicalType": "QUATSCH",
            },
            timeout=25,
        )
        assert r.status_code == 201, r.text
        assert r.json()["booking"]["medicalType"] is None

    def test_recurring_requires_login(self):
        r = requests.post(
            f"{BASE_URL}/api/recurring",
            json={
                "pickup": {"address": "Zuhause", **HOME},
                "dest": {"address": "Dialyse", **CENTER},
                "daysOfWeek": [1, 3, 5],
                "timeOfDay": "08:00",
            },
            timeout=20,
        )
        assert r.status_code == 401, r.text
        assert r.json().get("code") == "LOGIN_REQUIRED"

    def test_recurring_create_list_cancel(self):
        ts = int(time.time() * 1000)
        s, _ = _account(ts)
        r = s.post(
            f"{BASE_URL}/api/recurring",
            json={
                "pickup": {"address": "Zuhause", **HOME},
                "dest": {"address": "Dialysezentrum", **CENTER},
                "vehicleClass": "WHEELCHAIR",
                "medicalType": "DIALYSE",
                "daysOfWeek": ALL_DAYS,
                "timeOfDay": "08:00",
            },
            timeout=30,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["created"] >= 1, body
        rec = body["recurring"]
        assert rec["active"] is True
        assert rec["medicalType"] == "DIALYSE"
        assert len(rec["upcoming"]) >= 1
        first = rec["upcoming"][0]
        assert first["vehicleClass"] == "WHEELCHAIR"
        assert first["medicalType"] == "DIALYSE"
        assert first["recurringId"] == rec["id"]
        rid = rec["id"]

        # Listing enthält die Serie.
        gl = s.get(f"{BASE_URL}/api/recurring", timeout=15)
        assert gl.status_code == 200, gl.text
        assert any(x["id"] == rid for x in gl.json()["recurring"])

        # Beenden -> deaktiviert + künftige Fahrten storniert.
        dl = s.delete(f"{BASE_URL}/api/recurring/{rid}", timeout=20)
        assert dl.status_code == 200, dl.text
        assert dl.json()["cancelled"] >= 1
        after = next(x for x in s.get(f"{BASE_URL}/api/recurring", timeout=15).json()["recurring"] if x["id"] == rid)
        assert after["active"] is False
        assert len(after["upcoming"]) == 0  # künftige Fahrten storniert

    def test_recurring_return_trip_both_directions(self):
        ts = int(time.time() * 1000) + 1
        s, _ = _account(ts)
        r = s.post(
            f"{BASE_URL}/api/recurring",
            json={
                "pickup": {"address": "Zuhause-RT", **HOME},
                "dest": {"address": "Reha-RT", **CENTER},
                "vehicleClass": "WHEELCHAIR",
                "medicalType": "REHA",
                "daysOfWeek": ALL_DAYS,
                "timeOfDay": "08:00",
                "returnTrip": True,
                "returnTimeOfDay": "13:00",
            },
            timeout=30,
        )
        assert r.status_code == 201, r.text
        upcoming = r.json()["recurring"]["upcoming"]
        # Es gibt Hin- (Abholung Zuhause) UND Rückfahrten (Abholung Reha).
        out = [b for b in upcoming if b["pickupAddress"] == "Zuhause-RT"]
        back = [b for b in upcoming if b["pickupAddress"] == "Reha-RT"]
        assert len(out) >= 1, upcoming
        assert len(back) >= 1, upcoming
