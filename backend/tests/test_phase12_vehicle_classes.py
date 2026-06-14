"""Iteration 20 – Fahrzeug-Marktplatz: Preisvergleich je Klasse im Quote,
Klassen-Faktor im Buchungspreis, gespeicherte Fahrzeugklasse, Default bei
ungültiger Klasse sowie Admin-Konfiguration (Klassenpreise + Fahrerklasse).
"""
import os
import time
import random
import string
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://5edd2c00-4649-42ac-89e2-a6ce5e73bc02.preview.emergentagent.com"
).rstrip("/")

HBF = {"lat": 52.3759, "lng": 9.7320}
KROEPCKE = {"lat": 52.3719, "lng": 9.7385}


def _rand(n=5):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _quote(**extra):
    body = {"from": HBF, "to": KROEPCKE}
    body.update(extra)
    return requests.post(f"{BASE_URL}/api/quote", json=body, timeout=20).json()


def _cls(quote, key):
    return next((c for c in quote.get("classes", []) if c["key"] == key), None)


class TestVehicleMarketplace:
    def test_quote_returns_class_comparison(self):
        q = _quote()
        assert isinstance(q.get("classes"), list) and len(q["classes"]) >= 5, q
        std = _cls(q, "STANDARD")
        van = _cls(q, "VAN")
        biz = _cls(q, "BUSINESS")
        assert std and van and biz, q["classes"]
        # Standard ist die günstigste Basis; Großraum/Business teurer (Faktor > 1).
        assert van["price"] > std["price"], (std, van)
        assert biz["price"] > std["price"], (std, biz)
        for c in q["classes"]:
            assert c["price"] > 0 and "seats" in c and "luggage" in c

    def test_quote_fit_flags_for_group(self):
        q = _quote(passengers=8, luggage=0)
        std = _cls(q, "STANDARD")
        van = _cls(q, "VAN")
        # 8 Personen passen NICHT ins Standardtaxi (4), aber in den Großraum (8).
        assert std["fits"] is False, std
        assert van["fits"] is True, van

    def test_booking_stores_class_and_scaled_price(self):
        q = _quote()
        std_price = _cls(q, "STANDARD")["price"]
        van_price = _cls(q, "VAN")["price"]
        assert van_price > std_price

        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={
                "customerName": "TEST_VClass",
                "customerPhone": f"0151{int(time.time()*1000) % 10_000_000:07d}",
                "pickupAddress": "HBF Hannover",
                "pickup": HBF,
                "destAddress": "Kröpcke",
                "dest": KROEPCKE,
                "vehicleClass": "VAN",
            },
            timeout=25,
        )
        assert r.status_code == 201, r.text
        b = r.json()["booking"]
        assert b["vehicleClass"] == "VAN", b
        # Buchungs-„ca."-Preis entspricht dem Großraum-Quote (gleicher Faktor).
        assert abs(b["priceApprox"] - van_price) <= max(1.0, van_price * 0.06), (b["priceApprox"], van_price)
        assert b["priceApprox"] > std_price

    def test_invalid_class_defaults_to_standard(self):
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={
                "customerName": "TEST_VClassBad",
                "customerPhone": f"0152{int(time.time()*1000) % 10_000_000:07d}",
                "pickupAddress": "HBF Hannover",
                "pickup": HBF,
                "destAddress": "Kröpcke",
                "dest": KROEPCKE,
                "vehicleClass": "NICHT_EXISTENT",
            },
            timeout=25,
        )
        assert r.status_code == 201, r.text
        assert r.json()["booking"]["vehicleClass"] == "STANDARD"

    def test_admin_class_pricing_and_driver_class(self):
        ts = int(time.time() * 1000)
        s = requests.Session()
        reg = s.post(
            f"{BASE_URL}/api/companies/register",
            json={"name": f"TEST_VC_{ts}", "email": f"vc+{ts}@test.com", "password": "Pass1234", "cityTier": "SMALL"},
            timeout=25,
        )
        assert reg.status_code in (200, 201), reg.text

        # Klassen-Konfiguration: 9 Klassen mit Defaults.
        g = s.get(f"{BASE_URL}/api/admin/vehicle-classes", timeout=15)
        assert g.status_code == 200, g.text
        classes = g.json()["classes"]
        assert len(classes) == 9, classes
        assert any(c["key"] == "VAN" for c in classes)

        # VAN-Faktor ändern + Business deaktivieren.
        put = s.put(
            f"{BASE_URL}/api/admin/vehicle-classes",
            json={"classes": [
                {"key": "VAN", "enabled": True, "multiplier": 2.0, "flatSurcharge": 5},
                {"key": "BUSINESS", "enabled": False},
            ]},
            timeout=15,
        )
        assert put.status_code == 200, put.text
        g2 = s.get(f"{BASE_URL}/api/admin/vehicle-classes", timeout=15).json()["classes"]
        van = next(c for c in g2 if c["key"] == "VAN")
        biz = next(c for c in g2 if c["key"] == "BUSINESS")
        assert van["multiplier"] == 2.0 and van["flatSurcharge"] == 5, van
        assert biz["enabled"] is False, biz

        # Fahrer mit Fahrzeugklasse anlegen.
        uname = f"vcdrv{ts}{_rand(3)}"
        drv = s.post(
            f"{BASE_URL}/api/admin/drivers",
            json={"name": "VC Fahrer", "username": uname, "password": "Pass1234", "vehiclePlate": "H-VC 1", "vehicleClass": "VAN"},
            timeout=15,
        )
        assert drv.status_code in (200, 201), drv.text
        assert drv.json()["driver"]["vehicleClass"] == "VAN", drv.json()

        # Firmen-Quote nutzt den geänderten VAN-Faktor (×2.0 + 5).
        slug = None
        ov = s.get(f"{BASE_URL}/api/admin/overview", timeout=15)
        if ov.status_code == 200:
            slug = ov.json().get("company", {}).get("slug")
        if slug:
            q = _quote(company=slug)
            std = _cls(q, "STANDARD")
            van_q = _cls(q, "VAN")
            assert van_q is not None and std is not None
            # VAN (×2.0+5) deutlich teurer als Standard (×1.0).
            assert van_q["price"] > std["price"] * 1.8, (std, van_q)
