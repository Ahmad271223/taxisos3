"""Iteration 22 – Flughafen-Modul: Flug-Lookup (Mock inkl. Verspätungssimulation),
Ankunfts-Buchung leitet die Abholzeit aus geplanter Landung + Verspätung +
Gepäckpuffer ab, Abflug-Buchung nutzt die gewählte Abholzeit.
"""
import os
import time
from datetime import datetime, timedelta, timezone
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://5edd2c00-4649-42ac-89e2-a6ce5e73bc02.preview.emergentagent.com"
).rstrip("/")

HBF = {"lat": 52.3759, "lng": 9.7320}
HAJ = {"lat": 52.4602, "lng": 9.6850}  # Flughafen Hannover
BUFFER_MIN = 30


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _parse(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


class TestAirportModule:
    def test_flight_lookup_on_time(self):
        r = requests.post(f"{BASE_URL}/api/flights/lookup", json={"flightNumber": "LH123", "direction": "ARRIVAL"}, timeout=15)
        assert r.status_code == 200, r.text
        f = r.json()["flight"]
        assert f["status"] == "SCHEDULED"
        assert f["delayMinutes"] == 0
        assert f["terminal"]

    def test_flight_lookup_delayed(self):
        r = requests.post(f"{BASE_URL}/api/flights/lookup", json={"flightNumber": "LH9999", "direction": "ARRIVAL"}, timeout=15)
        assert r.status_code == 200, r.text
        f = r.json()["flight"]
        assert f["status"] == "DELAYED"
        assert f["delayMinutes"] == 75

    def test_arrival_pickup_from_flight(self):
        landing = datetime.now(timezone.utc) + timedelta(days=2)
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={
                "customerName": "TEST_Air",
                "customerPhone": f"0171{int(time.time()*1000) % 10_000_000:07d}",
                "pickupAddress": "Flughafen Hannover",
                "pickup": HAJ,
                "destAddress": "HBF Hannover",
                "dest": HBF,
                "flightNumber": "LH123",
                "flightDirection": "ARRIVAL",
                "terminal": "A",
                "flightStatus": "SCHEDULED",
                "flightScheduledAt": _iso(landing),
                "flightDelayMinutes": 0,
            },
            timeout=25,
        )
        assert r.status_code == 201, r.text
        b = r.json()["booking"]
        assert b["isScheduled"] is True
        assert b["flightNumber"] == "LH123"
        assert b["terminal"] == "A"
        # Abholung = Landung + Gepäckpuffer (30 Min.)
        diff = (_parse(b["scheduledAt"]) - landing).total_seconds() / 60
        assert abs(diff - BUFFER_MIN) < 1.5, (diff, b["scheduledAt"])

    def test_arrival_delay_shifts_pickup(self):
        landing = datetime.now(timezone.utc) + timedelta(days=2)
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={
                "customerName": "TEST_AirDelay",
                "customerPhone": f"0172{int(time.time()*1000) % 10_000_000:07d}",
                "pickupAddress": "Flughafen Hannover",
                "pickup": HAJ,
                "destAddress": "HBF Hannover",
                "dest": HBF,
                "flightNumber": "LH9999",
                "flightDirection": "ARRIVAL",
                "flightStatus": "DELAYED",
                "flightScheduledAt": _iso(landing),
                "flightDelayMinutes": 75,
            },
            timeout=25,
        )
        assert r.status_code == 201, r.text
        b = r.json()["booking"]
        # Abholung = Landung + 75 Min. Verspätung + 30 Min. Puffer
        diff = (_parse(b["scheduledAt"]) - landing).total_seconds() / 60
        assert abs(diff - (75 + BUFFER_MIN)) < 1.5, (diff, b["scheduledAt"])

    def test_departure_uses_chosen_pickup(self):
        pickup_at = datetime.now(timezone.utc) + timedelta(days=2)
        departure = pickup_at + timedelta(minutes=150)
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={
                "customerName": "TEST_Dep",
                "customerPhone": f"0173{int(time.time()*1000) % 10_000_000:07d}",
                "pickupAddress": "HBF Hannover",
                "pickup": HBF,
                "destAddress": "Flughafen Hannover",
                "dest": HAJ,
                "flightNumber": "LH456",
                "flightDirection": "DEPARTURE",
                "flightScheduledAt": _iso(departure),
                "scheduledAt": _iso(pickup_at),
            },
            timeout=25,
        )
        assert r.status_code == 201, r.text
        b = r.json()["booking"]
        assert b["flightDirection"] == "DEPARTURE"
        # Abflug: die GEWÄHLTE Abholzeit bleibt erhalten (kein Flug-Override).
        diff = abs((_parse(b["scheduledAt"]) - pickup_at).total_seconds())
        assert diff < 90, (b["scheduledAt"], _iso(pickup_at))
