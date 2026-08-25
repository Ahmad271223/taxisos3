"""Iteration 19 – Kundenkonto: Registrierung (mit Telefon-Verifizierung), Login,
rollen-getrenntes Cookie (tc_customer), /api/auth/me.customer, eigene Fahrten unter
/api/customer/bookings sowie Zuordnung einer Buchung zum Konto inkl. übersprungener
SMS-Verifizierung, wenn mit der bestätigten Kontonummer gebucht wird.
"""
import os
import time
import random
import string
import requests

# Testpasswort NICHT im Repository hinterlegen – es landet sonst dauerhaft
# im Git-Verlauf. Ueber die Umgebung setzen.
TEST_PASSWORT = os.environ.get("QA_TEST_PASSWORT", "Pass!QA-2026")

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://taxios-dispatch.preview.emergentagent.com"
).rstrip("/")


def _rand(n=5):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _verify_token(phone: str):
    """Holt im Mock-Modus einen Verifizierungs-Token (devCode-Flow)."""
    rq = requests.post(f"{BASE_URL}/api/verify/request", json={"channel": "SMS", "target": phone}, timeout=15)
    code = rq.json().get("devCode")
    if not code:
        return None
    rc = requests.post(
        f"{BASE_URL}/api/verify/confirm",
        json={"channel": "SMS", "target": phone, "code": code},
        timeout=15,
    )
    return rc.json().get("token")


class TestCustomerAccount:
    def test_register_login_me_and_own_bookings(self):
        ts = int(time.time() * 1000)
        email = f"kunde+{ts}@test.com"
        phone = f"0151{ts % 10_000_000:07d}"
        token = _verify_token(phone)
        s = requests.Session()

        # Registrieren (Telefon bestätigt) -> setzt tc_customer
        r = s.post(
            f"{BASE_URL}/api/customer/register",
            json={"name": "Test Kunde", "email": email, "phone": phone, "password": TEST_PASSWORT, "verificationToken": token},
            timeout=20,
        )
        assert r.status_code in (200, 201), r.text

        # /api/auth/me liefert die Kundensession inkl. Telefon
        me = s.get(f"{BASE_URL}/api/auth/me", timeout=15).json()
        assert me.get("customer", {}).get("role") == "CUSTOMER", f"customer fehlt: {me}"
        assert me["customer"].get("phone") == phone, f"phone fehlt in session: {me}"

        # Buchung mit der bestätigten Kontonummer -> KEIN Token nötig (_noverify),
        # wird trotzdem akzeptiert und dem Konto zugeordnet.
        rb = s.post(
            f"{BASE_URL}/api/bookings",
            json={
                "customerName": "Test Kunde",
                "customerPhone": phone,
                "pickupAddress": "HBF Hannover",
                "pickup": {"lat": 52.3759, "lng": 9.7320},
                "destAddress": "Kröpcke Hannover",
                "dest": {"lat": 52.3719, "lng": 9.7385},
                "_noverify": True,
            },
            timeout=25,
        )
        assert rb.status_code in (200, 201), f"Buchung mit Kontonummer sollte ohne Token gehen: {rb.text}"
        bid = rb.json()["id"]

        # Eigene Fahrten enthalten die Buchung
        rl = s.get(f"{BASE_URL}/api/customer/bookings", timeout=15)
        assert rl.status_code == 200, rl.text
        data = rl.json()
        assert data.get("customer", {}).get("email") == email
        assert any(b["id"] == bid for b in data.get("bookings", [])), f"Buchung nicht im Konto: {data}"

        # Logout (scope=customer) -> Konto-Endpunkt gesperrt
        s.post(f"{BASE_URL}/api/auth/logout?scope=customer", timeout=15)
        assert s.get(f"{BASE_URL}/api/customer/bookings", timeout=15).status_code == 401

        # Erneut anmelden mit E-Mail + Passwort
        rlogin = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": TEST_PASSWORT, "role": "CUSTOMER"},
            timeout=15,
        )
        assert rlogin.status_code == 200 and rlogin.json().get("role") == "CUSTOMER", rlogin.text
        assert s.get(f"{BASE_URL}/api/customer/bookings", timeout=15).status_code == 200

    def test_duplicate_email_rejected(self):
        ts = int(time.time() * 1000)
        email = f"dup+{ts}@test.com"
        phone = f"0152{ts % 10_000_000:07d}"
        body = {"name": "Dup", "email": email, "phone": phone, "password": TEST_PASSWORT, "verificationToken": _verify_token(phone)}
        r1 = requests.post(f"{BASE_URL}/api/customer/register", json=body, timeout=20)
        assert r1.status_code in (200, 201), r1.text
        body2 = dict(body, verificationToken=_verify_token(phone))
        r2 = requests.post(f"{BASE_URL}/api/customer/register", json=body2, timeout=20)
        assert r2.status_code == 409, f"doppelte E-Mail sollte 409 sein: {r2.status_code} {r2.text}"

    def test_wrong_password_rejected(self):
        ts = int(time.time() * 1000)
        email = f"wrong+{ts}@test.com"
        phone = f"0153{ts % 10_000_000:07d}"
        requests.post(
            f"{BASE_URL}/api/customer/register",
            json={"name": "WP", "email": email, "phone": phone, "password": TEST_PASSWORT, "verificationToken": _verify_token(phone)},
            timeout=20,
        )
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": email, "password": "falsch999", "role": "CUSTOMER"},
            timeout=15,
        )
        assert r.status_code == 401, r.text
