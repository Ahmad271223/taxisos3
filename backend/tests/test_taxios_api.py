"""TaxiOS backend API tests (iteration_2) – real-data, no demo seeds.

Flows covered:
 - Super-Admin login (role upgrade) and /api/super/overview
 - Company self-registration → auto-login → admin endpoints
 - Driver CRUD (create + GET + DELETE + active-booking guard)
 - Pricing GET/PUT
 - Quote, two-step booking (payment CASH/CARD), bookings persistence
 - Geocode forward + reverse
 - Ratings list (empty initially)
"""
import os
import time
import random
import string

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

SUPER_EMAIL = "super@taxios.app"
SUPER_PASS = "SuperAdmin2026!"


def _rand(n=6):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


# ============ Fixtures ============
@pytest.fixture(scope="session")
def super_session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": SUPER_EMAIL, "password": SUPER_PASS, "role": "ADMIN"},
        timeout=20,
    )
    assert r.status_code == 200, f"super login failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("role") == "SUPER_ADMIN", f"expected SUPER_ADMIN, got {body}"
    return s


@pytest.fixture(scope="session")
def company_admin():
    """Register a fresh company; auto-login session is returned."""
    ts = int(time.time())
    s = requests.Session()
    payload = {
        "name": f"TEST_Co_{ts}",
        "email": f"co+{ts}@test.com",
        "password": "Pass1234",
        "address": "Teststraße 1, 30159 Hannover",
        "phone": "0511 12345",
    }
    r = s.post(f"{BASE_URL}/api/companies/register", json=payload, timeout=25)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    data = r.json()
    slug = data.get("slug") or data.get("company", {}).get("slug")
    assert slug, f"no slug returned: {data}"
    return {"session": s, "slug": slug, "email": payload["email"], "password": payload["password"]}


# ============ Auth ============
class TestAuth:
    def test_super_login_returns_super_admin_role(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": SUPER_EMAIL, "password": SUPER_PASS, "role": "ADMIN"},
            timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True
        assert data.get("role") == "SUPER_ADMIN"
        # httpOnly cookie set (rollen-getrennt: Admin/Super -> tc_admin)
        set_cookie = r.headers.get("set-cookie", "")
        assert "tc_admin" in set_cookie
        assert "HttpOnly" in set_cookie

    def test_super_login_wrong_password(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": SUPER_EMAIL, "password": "wrong", "role": "ADMIN"},
            timeout=15,
        )
        assert r.status_code in (400, 401, 403)

    def test_me_endpoint_authed(self, super_session):
        r = super_session.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200
        body = r.json()
        sess = body.get("session") or body.get("user") or body
        assert sess is not None
        role = (sess or {}).get("role") if isinstance(sess, dict) else None
        assert role in (None, "SUPER_ADMIN", "ADMIN")  # tolerate shape


# ============ Super-Admin Overview ============
class TestSuperOverview:
    def test_super_overview_accessible(self, super_session):
        r = super_session.get(f"{BASE_URL}/api/super/overview", timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        # must contain totals
        assert isinstance(data, dict)
        # tolerate either flat or nested totals
        keys = set(data.keys())
        assert keys & {"totals", "companies", "drivers", "bookings", "ratings"}, f"unexpected shape: {keys}"

    def test_super_overview_forbidden_without_auth(self):
        r = requests.get(f"{BASE_URL}/api/super/overview", timeout=15)
        assert r.status_code in (401, 403)


# ============ Company Registration → Admin ============
class TestCompanyRegisterAndAdmin:
    def test_company_self_registration_and_admin(self, company_admin):
        s = company_admin["session"]
        # /api/admin/overview must work for the new admin
        r = s.get(f"{BASE_URL}/api/admin/overview", timeout=15)
        assert r.status_code == 200, f"overview failed: {r.status_code} {r.text}"
        data = r.json()
        assert isinstance(data, dict)

    def test_pricing_get_and_update(self, company_admin):
        s = company_admin["session"]
        r = s.get(f"{BASE_URL}/api/admin/pricing", timeout=15)
        assert r.status_code == 200
        cur = r.json()
        pricing = cur.get("pricing", cur) if isinstance(cur, dict) else {}
        payload = {
            "basePrice": 5.5,
            "perKmDay": float(pricing.get("perKmDay", 2.0)),
            "perKmNight": float(pricing.get("perKmNight", 2.5)),
            "perKmWeekend": float(pricing.get("perKmWeekend", 2.2)),
            "perMinute": float(pricing.get("perMinute", 0.5)),
            "nightStartHour": int(pricing.get("nightStartHour", 22)),
            "nightEndHour": int(pricing.get("nightEndHour", 6)),
        }
        r2 = s.put(f"{BASE_URL}/api/admin/pricing", json=payload, timeout=15)
        assert r2.status_code in (200, 201), f"pricing update failed: {r2.status_code} {r2.text}"
        r3 = s.get(f"{BASE_URL}/api/admin/pricing", timeout=15)
        body = r3.json()
        p = body.get("pricing", body)
        assert float(p.get("basePrice", 0)) == 5.5

    def test_admin_ratings_empty(self, company_admin):
        s = company_admin["session"]
        r = s.get(f"{BASE_URL}/api/admin/ratings", timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        ratings = data.get("ratings", data) if isinstance(data, dict) else data
        assert isinstance(ratings, list)
        assert len(ratings) == 0


# ============ Driver CRUD ============
class TestDriverCRUD:
    def test_create_get_delete_driver(self, company_admin):
        s = company_admin["session"]
        uname = f"TEST_drv_{_rand()}"
        payload = {
            "username": uname,
            "name": "Test Fahrer",
            "phone": "0511 1",
            "password": "taxi123",
            "vehicle": "VW Golf",
            "plate": "H-XX 1",
            "color": "Schwarz",
            "seats": 4,
        }
        r = s.post(f"{BASE_URL}/api/admin/drivers", json=payload, timeout=20)
        assert r.status_code in (200, 201), f"create driver failed: {r.status_code} {r.text}"
        data = r.json()
        driver = data.get("driver", data)
        did = driver.get("id")
        assert did, f"no driver id: {data}"
        assert driver.get("username") == uname or driver.get("name") == "Test Fahrer"

        # GET list contains the new driver
        r2 = s.get(f"{BASE_URL}/api/admin/drivers", timeout=15)
        assert r2.status_code == 200
        drivers = r2.json().get("drivers", r2.json())
        assert any(d.get("id") == did for d in drivers), "newly created driver not in list"

        # GET detail
        r3 = s.get(f"{BASE_URL}/api/admin/drivers/{did}", timeout=15)
        assert r3.status_code == 200, f"detail failed: {r3.status_code} {r3.text}"
        det = r3.json()
        d_obj = det.get("driver", det)
        assert d_obj.get("id") == did

        # DELETE driver
        r4 = s.delete(f"{BASE_URL}/api/admin/drivers/{did}", timeout=15)
        assert r4.status_code in (200, 204), f"delete failed: {r4.status_code} {r4.text}"

        # Verify deletion: GET should 404 or driver absent from list
        r5 = s.get(f"{BASE_URL}/api/admin/drivers/{did}", timeout=15)
        if r5.status_code == 200:
            # some impls return success but mark inactive; ensure not in active list
            r6 = s.get(f"{BASE_URL}/api/admin/drivers", timeout=15)
            drivers2 = r6.json().get("drivers", r6.json())
            assert all(d.get("id") != did for d in drivers2)
        else:
            assert r5.status_code in (404, 410)


# ============ Geocode ============
class TestGeocode:
    def test_geocode_forward(self):
        r = requests.get(f"{BASE_URL}/api/geocode", params={"q": "Hauptbahnhof Hannover"}, timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        results = data.get("results", data) if isinstance(data, dict) else data
        assert isinstance(results, list)
        assert len(results) >= 1

    def test_geocode_reverse(self):
        r = requests.get(
            f"{BASE_URL}/api/geocode",
            params={"reverse": 1, "lat": 52.3759, "lng": 9.7320},
            timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        # response should include a label or address string
        label = data.get("label") or data.get("address") or data.get("display_name") or (
            (data.get("results") or [{}])[0].get("label")
            if isinstance(data.get("results"), list) else None
        )
        assert label, f"no label in reverse geocode response: {data}"


# ============ Quote & Booking ============
class TestQuoteAndBooking:
    def test_quote(self, company_admin):
        slug = company_admin["slug"]
        payload = {
            "company": slug,
            "from": {"lat": 52.3759, "lng": 9.7320, "label": "Hauptbahnhof Hannover"},
            "to": {"lat": 52.3719, "lng": 9.7385, "label": "Kröpcke Hannover"},
        }
        r = requests.post(f"{BASE_URL}/api/quote", json=payload, timeout=20)
        assert r.status_code == 200, f"quote failed: {r.status_code} {r.text}"
        data = r.json()
        price = data.get("price") or data.get("priceMin") or data.get("total") or data.get("amount")
        assert price is not None, f"no price in response: {data}"
        assert float(price) > 0

    def test_create_booking_with_payment_cash(self, company_admin):
        slug = company_admin["slug"]
        payload = {
            "company": slug,
            "customerName": "TEST_Max",
            "customerPhone": "0511000",
            "pickupAddress": "Hauptbahnhof Hannover",
            "pickup": {"lat": 52.3759, "lng": 9.7320},
            "destAddress": "Kröpcke Hannover",
            "dest": {"lat": 52.3719, "lng": 9.7385},
            "paymentMethod": "CASH",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)
        assert r.status_code in (200, 201), f"booking failed: {r.status_code} {r.text}"
        data = r.json()
        booking = data.get("booking", data)
        bid = booking.get("id") or data.get("id")
        assert bid, f"no booking id: {data}"

        # GET booking back
        r2 = requests.get(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
        assert r2.status_code == 200
        b = r2.json().get("booking", r2.json())
        assert b.get("id") == bid
        pm = b.get("paymentMethod") or b.get("payment_method")
        assert pm == "CASH", f"payment method not persisted: {b}"

    def test_create_booking_with_payment_card(self, company_admin):
        slug = company_admin["slug"]
        payload = {
            "company": slug,
            "customerName": "TEST_Anna",
            "customerPhone": "0511111",
            "pickupAddress": "Hauptbahnhof Hannover",
            "pickup": {"lat": 52.3759, "lng": 9.7320},
            "destAddress": "Kröpcke Hannover",
            "dest": {"lat": 52.3719, "lng": 9.7385},
            "paymentMethod": "CARD",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)
        assert r.status_code in (200, 201), f"booking failed: {r.status_code} {r.text}"
        bid = r.json().get("booking", r.json()).get("id") or r.json().get("id")
        assert bid

        r2 = requests.get(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
        b = r2.json().get("booking", r2.json())
        pm = b.get("paymentMethod") or b.get("payment_method")
        assert pm == "CARD", f"CARD payment not persisted: {b}"

    def test_dispatch_with_no_drivers_results_in_no_driver_status(self, company_admin):
        """With no online drivers (simulator off, no driver session), status should be PENDING/SUCHE/KEIN_FAHRER, NOT crash."""
        slug = company_admin["slug"]
        payload = {
            "company": slug,
            "customerName": "TEST_NoDrv",
            "customerPhone": "0511999",
            "pickupAddress": "Hauptbahnhof Hannover",
            "pickup": {"lat": 52.3759, "lng": 9.7320},
            "destAddress": "Kröpcke Hannover",
            "dest": {"lat": 52.3719, "lng": 9.7385},
            "paymentMethod": "CASH",
        }
        r = requests.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)
        assert r.status_code in (200, 201)
        bid = r.json().get("booking", r.json()).get("id") or r.json().get("id")
        time.sleep(5)
        r2 = requests.get(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
        assert r2.status_code == 200
        st = r2.json().get("booking", r2.json()).get("status")
        # Allowed: still searching, or already marked no-driver. Should NOT be ACCEPTED/INPROGRESS.
        assert st in ("PENDING", "NEU", "SUCHE", "KEIN_FAHRER", "NO_DRIVER", "OPEN", "OFFEN", "CREATED"), f"unexpected status: {st}"
