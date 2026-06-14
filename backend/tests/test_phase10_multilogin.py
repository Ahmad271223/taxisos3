"""Iteration 18 – Mehrfach-Login: Admin UND Fahrer gleichzeitig (rollen-getrennte
Cookies tc_admin/tc_driver) + scope-basiertes Logout.
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


def _rand(n=5):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


class TestMultiLogin:
    def test_admin_and_driver_logged_in_same_session(self):
        ts = int(time.time() * 1000)
        s = requests.Session()
        # Firma registrieren -> Admin-Login (tc_admin)
        r = s.post(
            f"{BASE_URL}/api/companies/register",
            json={"name": f"TEST_ML_{ts}", "email": f"ml+{ts}@test.com", "password": "Pass1234"},
            timeout=25,
        )
        assert r.status_code in (200, 201), r.text
        # Fahrer anlegen (Admin authentifiziert)
        uname = f"mldrv{ts}{_rand(3)}"
        rd = s.post(
            f"{BASE_URL}/api/admin/drivers",
            json={"name": "ML Fahrer", "username": uname, "password": "Pass1234", "vehiclePlate": "H-ML 1"},
            timeout=15,
        )
        assert rd.status_code in (200, 201), rd.text

        # Im SELBEN Session-Cookie-Jar zusätzlich als Fahrer einloggen (tc_driver)
        rl = s.post(f"{BASE_URL}/api/auth/login", json={"username": uname, "password": "Pass1234"}, timeout=15)
        assert rl.status_code == 200 and rl.json().get("role") == "DRIVER"

        # /api/auth/me liefert BEIDE Sessions
        me = s.get(f"{BASE_URL}/api/auth/me", timeout=15).json()
        assert me.get("admin", {}).get("role") == "ADMIN", f"admin fehlt: {me}"
        assert me.get("driver", {}).get("role") == "DRIVER", f"driver fehlt: {me}"

        # BEIDE Bereiche funktionieren gleichzeitig
        assert s.get(f"{BASE_URL}/api/admin/overview", timeout=15).status_code == 200
        assert s.get(f"{BASE_URL}/api/driver/summary", timeout=15).status_code == 200

    def test_scope_logout_keeps_other_session(self):
        ts = int(time.time() * 1000)
        s = requests.Session()
        s.post(
            f"{BASE_URL}/api/companies/register",
            json={"name": f"TEST_ML2_{ts}", "email": f"ml2+{ts}@test.com", "password": "Pass1234"},
            timeout=25,
        )
        uname = f"ml2drv{ts}{_rand(3)}"
        s.post(
            f"{BASE_URL}/api/admin/drivers",
            json={"name": "ML2", "username": uname, "password": "Pass1234", "vehiclePlate": "H-ML 2"},
            timeout=15,
        )
        s.post(f"{BASE_URL}/api/auth/login", json={"username": uname, "password": "Pass1234"}, timeout=15)
        # beide aktiv
        assert s.get(f"{BASE_URL}/api/admin/overview", timeout=15).status_code == 200
        assert s.get(f"{BASE_URL}/api/driver/summary", timeout=15).status_code == 200
        # nur Fahrer abmelden
        s.post(f"{BASE_URL}/api/auth/logout?scope=driver", timeout=15)
        assert s.get(f"{BASE_URL}/api/driver/summary", timeout=15).status_code == 401
        assert s.get(f"{BASE_URL}/api/admin/overview", timeout=15).status_code == 200, "Admin sollte eingeloggt bleiben"
