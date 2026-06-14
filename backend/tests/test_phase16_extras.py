"""Iteration 24 – Live-Karte, SOS, Favoriten/Punkte, Fahrtbeleg-PDF, Karte für
Gruppen. (Live-Karten-Dispatch wird per Node-E2E geprüft; hier die HTTP-APIs.)
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
CENTER = {"lat": 52.3719, "lng": 9.7385}


def _verify_token(phone: str):
    rq = requests.post(f"{BASE_URL}/api/verify/request", json={"channel": "SMS", "target": phone}, timeout=15)
    code = rq.json().get("devCode")
    if not code:
        return None
    rc = requests.post(f"{BASE_URL}/api/verify/confirm", json={"channel": "SMS", "target": phone, "code": code}, timeout=15)
    return rc.json().get("token")


def _account(ts):
    email = f"extra+{ts}@test.com"
    phone = f"0191{ts % 10_000_000:07d}"
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/customer/register",
        json={"name": "Extra Kunde", "email": email, "phone": phone, "password": "Pass1234", "verificationToken": _verify_token(phone)},
        timeout=20,
    )
    assert r.status_code in (200, 201), r.text
    return s, phone


class TestLiveMap:
    def test_endpoint_shape(self):
        r = requests.get(f"{BASE_URL}/api/taxis/live", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "taxis" in d and isinstance(d["taxis"], list)
        assert "available" in d


class TestSos:
    def test_sos_creates_alert(self):
        ts = int(time.time() * 1000)
        s, _ = _account(ts)
        # Notfallkontakt setzen
        p = s.patch(f"{BASE_URL}/api/customer/profile", json={"emergencyContactName": "Mama", "emergencyContactPhone": "0151000111"}, timeout=15)
        assert p.status_code == 200, p.text
        assert p.json()["profile"]["emergencyContactPhone"] == "0151000111"
        # SOS auslösen (eingeloggt) -> Alert + Benachrichtigung an Notfallkontakt
        r = s.post(f"{BASE_URL}/api/sos", json={"lat": 52.37, "lng": 9.73, "message": "Hilfe"}, timeout=15)
        assert r.status_code == 201, r.text
        assert r.json()["ok"] is True
        assert r.json()["notified"] >= 1


class TestFavoritesPoints:
    def test_profile_points_default_zero(self):
        ts = int(time.time() * 1000) + 1
        s, _ = _account(ts)
        prof = s.get(f"{BASE_URL}/api/customer/profile", timeout=15).json()["profile"]
        assert prof["points"] == 0

    def test_favorite_add_list_remove(self):
        ts = int(time.time() * 1000) + 2
        s, _ = _account(ts)
        # Firma + Fahrer anlegen (eigene Session als Admin)
        adm = requests.Session()
        adm.post(
            f"{BASE_URL}/api/companies/register",
            json={"name": f"FAV_{ts}", "email": f"fav{ts}@test.com", "password": "Pass1234", "cityTier": "SMALL"},
            timeout=25,
        )
        drv = adm.post(
            f"{BASE_URL}/api/admin/drivers",
            json={"name": "Fav Fahrer", "username": f"favdrv{ts}", "password": "Pass1234", "vehiclePlate": "H-FV 1", "vehicleClass": "STANDARD"},
            timeout=15,
        )
        did = drv.json()["driver"]["id"]
        # favorisieren
        a = s.post(f"{BASE_URL}/api/favorites", json={"driverId": did}, timeout=15)
        assert a.status_code in (200, 201), a.text
        favs = s.get(f"{BASE_URL}/api/favorites", timeout=15).json()["favorites"]
        assert any(f["driverId"] == did for f in favs)
        # entfernen
        s.delete(f"{BASE_URL}/api/favorites?driverId={did}", timeout=15)
        favs2 = s.get(f"{BASE_URL}/api/favorites", timeout=15).json()["favorites"]
        assert not any(f["driverId"] == did for f in favs2)

    def test_favorites_require_login(self):
        r = requests.get(f"{BASE_URL}/api/favorites", timeout=15)
        assert r.status_code == 401


class TestRideInvoice:
    def test_invoice_409_when_not_completed(self):
        r = requests.post(
            f"{BASE_URL}/api/bookings",
            json={
                "customerName": "TEST_Inv",
                "customerPhone": f"0192{int(time.time()*1000) % 10_000_000:07d}",
                "pickupAddress": "HBF",
                "pickup": HBF,
                "destAddress": "Kröpcke",
                "dest": CENTER,
            },
            timeout=25,
        )
        assert r.status_code == 201, r.text
        bid = r.json()["id"]
        inv = requests.get(f"{BASE_URL}/api/bookings/{bid}/invoice", timeout=15)
        assert inv.status_code == 409  # erst nach Abschluss

    def test_invoice_404_unknown(self):
        inv = requests.get(f"{BASE_URL}/api/bookings/does-not-exist/invoice", timeout=15)
        assert inv.status_code == 404


class TestGroupCard:
    def test_group_accepts_card(self):
        phone = f"0193{int(time.time()*1000) % 10_000_000:07d}"
        r = requests.post(
            f"{BASE_URL}/api/groups",
            json={
                "customerName": "TEST_GrpCard",
                "customerPhone": phone,
                "pickupAddress": "HBF",
                "pickup": HBF,
                "destAddress": "Kröpcke",
                "dest": CENTER,
                "vehicles": [{"vehicleClass": "STANDARD", "count": 2}],
                "totalPassengers": 6,
                "paymentMethod": "CARD",
                "verificationToken": _verify_token(phone),
            },
            timeout=30,
        )
        assert r.status_code == 201, r.text  # nicht mehr abgelehnt
        bookings = r.json()["group"]["bookings"]
        assert all(b["paymentMethod"] == "CARD" for b in bookings), bookings
