"""Iteration 21 – Gruppen-/Eventbuchung: eine Bestellung erzeugt N Fahrzeug-
Buchungen (Klasse/Preis je Fahrzeug), Eltern-Status via /api/groups/[id],
Personen-Verteilung, Kontonummer überspringt SMS, CARD (v1) abgelehnt.
"""
import os
import time
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://5edd2c00-4649-42ac-89e2-a6ce5e73bc02.preview.emergentagent.com"
).rstrip("/")

HBF = {"lat": 52.3759, "lng": 9.7320}
KROEPCKE = {"lat": 52.3719, "lng": 9.7385}


def _verify_token(phone: str):
    rq = requests.post(f"{BASE_URL}/api/verify/request", json={"channel": "SMS", "target": phone}, timeout=15)
    code = rq.json().get("devCode")
    if not code:
        return None
    rc = requests.post(f"{BASE_URL}/api/verify/confirm", json={"channel": "SMS", "target": phone, "code": code}, timeout=15)
    return rc.json().get("token")


def _group_body(phone, **extra):
    body = {
        "customerName": "TEST_Group",
        "customerPhone": phone,
        "pickupAddress": "HBF Hannover",
        "pickup": HBF,
        "destAddress": "Kröpcke",
        "dest": KROEPCKE,
        "verificationToken": _verify_token(phone),
    }
    body.update(extra)
    return body


class TestGroupBooking:
    def test_create_group_spawns_children(self):
        phone = f"0161{int(time.time()*1000) % 10_000_000:07d}"
        r = requests.post(
            f"{BASE_URL}/api/groups",
            json=_group_body(phone, vehicles=[{"vehicleClass": "STANDARD", "count": 3}], totalPassengers=10, totalLuggage=4, eventLabel="Hochzeit"),
            timeout=30,
        )
        assert r.status_code == 201, r.text
        g = r.json()["group"]
        assert g["vehicleCount"] == 3
        assert len(g["bookings"]) == 3, g
        assert all(b["vehicleClass"] == "STANDARD" for b in g["bookings"]), g["bookings"]
        assert all(b["groupId"] == g["id"] for b in g["bookings"]), g["bookings"]
        # Personen werden auf die Fahrzeuge verteilt (Summe = Gesamt).
        assert sum(b["passengers"] for b in g["bookings"]) == 10, g["bookings"]
        assert all(b["priceApprox"] > 0 for b in g["bookings"])

        # Status-Endpunkt liefert dieselbe Gruppe.
        gid = g["id"]
        gs = requests.get(f"{BASE_URL}/api/groups/{gid}", timeout=15)
        assert gs.status_code == 200, gs.text
        assert gs.json()["group"]["vehicleCount"] == 3

    def test_van_group_pricier_than_standard(self):
        # Standard-Preis als Referenz aus dem Quote.
        q = requests.post(f"{BASE_URL}/api/quote", json={"from": HBF, "to": KROEPCKE}, timeout=20).json()
        std_price = next(c["price"] for c in q["classes"] if c["key"] == "STANDARD")

        phone = f"0162{int(time.time()*1000) % 10_000_000:07d}"
        r = requests.post(
            f"{BASE_URL}/api/groups",
            json=_group_body(phone, vehicles=[{"vehicleClass": "VAN", "count": 2}], totalPassengers=12),
            timeout=30,
        )
        assert r.status_code == 201, r.text
        bookings = r.json()["group"]["bookings"]
        assert len(bookings) == 2
        assert all(b["vehicleClass"] == "VAN" for b in bookings)
        assert all(b["priceApprox"] > std_price for b in bookings), (std_price, bookings)

    def test_card_accepted_for_groups(self):
        # Seit Phase 20: Kartenzahlung (im Taxi) ist für Gruppen erlaubt.
        phone = f"0163{int(time.time()*1000) % 10_000_000:07d}"
        r = requests.post(
            f"{BASE_URL}/api/groups",
            json=_group_body(phone, vehicles=[{"vehicleClass": "STANDARD", "count": 2}], totalPassengers=6, paymentMethod="CARD"),
            timeout=30,
        )
        assert r.status_code == 201, r.text
        assert all(b["paymentMethod"] == "CARD" for b in r.json()["group"]["bookings"])

    def test_invalid_class_defaults_standard(self):
        phone = f"0164{int(time.time()*1000) % 10_000_000:07d}"
        r = requests.post(
            f"{BASE_URL}/api/groups",
            json=_group_body(phone, vehicles=[{"vehicleClass": "QUATSCH", "count": 2}], totalPassengers=6),
            timeout=30,
        )
        assert r.status_code == 201, r.text
        assert all(b["vehicleClass"] == "STANDARD" for b in r.json()["group"]["bookings"])

    def test_account_phone_skips_verification(self):
        ts = int(time.time() * 1000)
        email = f"grp+{ts}@test.com"
        phone = f"0165{ts % 10_000_000:07d}"
        s = requests.Session()
        reg = s.post(
            f"{BASE_URL}/api/customer/register",
            json={"name": "Grp Kunde", "email": email, "phone": phone, "password": "Pass1234", "verificationToken": _verify_token(phone)},
            timeout=20,
        )
        assert reg.status_code in (200, 201), reg.text
        # KEIN verificationToken -> trotzdem ok, weil Kontonummer bestätigt ist.
        r = s.post(
            f"{BASE_URL}/api/groups",
            json={
                "customerName": "Grp Kunde",
                "customerPhone": phone,
                "pickupAddress": "HBF Hannover",
                "pickup": HBF,
                "destAddress": "Kröpcke",
                "dest": KROEPCKE,
                "vehicles": [{"vehicleClass": "STANDARD", "count": 2}],
                "totalPassengers": 5,
            },
            timeout=30,
        )
        assert r.status_code == 201, r.text
        assert len(r.json()["group"]["bookings"]) == 2
