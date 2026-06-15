"""Iteration 5 – TaxiOS v2.0 Phase 1 tests.
Covers:
 a) Platform commission (BIG=7% / SMALL=5%) on POST /api/companies/register + GET /api/admin/overview + GET /api/super/overview shape.
 c) Cancellation protocol – customer & admin cancel routes + log endpoint.
 d) Exact fare field – priceExact persisted (verified via DTO field availability after acceptance flow simulated only by inspecting shape).
 Quick-win: GET /api/bookings/:id returns both flat and wrapped shape.

Note: ONLINE_RESERVED_NEXT_TRIP (b) and full driver-accept flow (d) require Socket.IO driver-client – out of pytest scope. Covered minimally by checking response shape includes priceExact/isReserved fields after non-driver booking.
"""
import os
import time
import random
import string
import pytest
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://taxios-dispatch.preview.emergentagent.com"
).rstrip("/")

SUPER_EMAIL = "super@taxios.app"
SUPER_PASS = "SuperAdmin2026!"


def _rand(n=6):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _register_company(city_tier=None):
    ts = int(time.time() * 1000)
    s = requests.Session()
    payload = {
        "name": f"TEST_Co_{ts}_{_rand(3)}",
        "email": f"co+{ts}{_rand(3)}@test.com",
        "password": "Pass1234",
        "address": "Teststr. 1",
        "phone": "0511 1",
    }
    if city_tier:
        payload["cityTier"] = city_tier
    r = s.post(f"{BASE_URL}/api/companies/register", json=payload, timeout=25)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    d = r.json()
    slug = d.get("slug") or d.get("company", {}).get("slug")
    return {"session": s, "slug": slug, "email": payload["email"]}


def _post_booking(payload):
    return requests.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)


def _create_booking_no_company():
    payload = {
        "customerName": f"TEST_{_rand()}",
        "customerPhone": "0511000",
        "pickupAddress": "HBF Hannover",
        "pickup": {"lat": 52.3759, "lng": 9.7320},
        "destAddress": "Kröpcke Hannover",
        "dest": {"lat": 52.3719, "lng": 9.7385},
        "paymentMethod": "CASH",
    }
    r = _post_booking(payload)
    assert r.status_code in (200, 201), f"booking failed: {r.status_code} {r.text}"
    return r.json().get("booking", r.json())


# ========= (a) Plattform-Provision – company registration cityTier =========
class TestCompanyCityTier:
    def test_register_with_cityTier_BIG_persisted(self):
        co = _register_company("BIG")
        # /api/admin/overview returns company.cityTier
        r = co["session"].get(f"{BASE_URL}/api/admin/overview", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("company", {}).get("cityTier") == "BIG", f"cityTier not BIG: {d}"

    def test_register_default_cityTier_SMALL(self):
        co = _register_company()  # no tier
        r = co["session"].get(f"{BASE_URL}/api/admin/overview", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("company", {}).get("cityTier") == "SMALL", f"default cityTier not SMALL: {d}"

    def test_register_invalid_cityTier_rejected(self):
        ts = int(time.time() * 1000)
        r = requests.post(
            f"{BASE_URL}/api/companies/register",
            json={
                "name": f"TEST_Bad_{ts}",
                "email": f"bad+{ts}@test.com",
                "password": "Pass1234",
                "cityTier": "MEDIUM",
            },
            timeout=15,
        )
        assert r.status_code in (400, 422), f"expected 400/422 got: {r.status_code} {r.text}"


# ========= (a) Admin overview – commission KPI shape =========
class TestAdminOverviewCommission:
    def test_admin_overview_today_month_shape(self):
        co = _register_company("BIG")
        r = co["session"].get(f"{BASE_URL}/api/admin/overview", timeout=15)
        assert r.status_code == 200
        d = r.json()
        # company.cityTier present
        assert d.get("company", {}).get("cityTier") == "BIG"
        # today + month with KPI fields
        for key in ("today", "month"):
            sub = d.get(key)
            assert isinstance(sub, dict), f"{key} missing"
            for f in ("trips", "revenue", "platformFee", "net", "avgFare"):
                assert f in sub, f"{key}.{f} missing in {sub}"
        assert "cancellations30d" in d


# ========= (a) Super overview – platform financials =========
class TestSuperOverviewFinancials:
    @pytest.fixture(scope="class")
    def super_sess(self):
        s = requests.Session()
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": SUPER_EMAIL, "password": SUPER_PASS, "role": "ADMIN"},
            timeout=20,
        )
        assert r.status_code == 200
        return s

    def test_super_overview_totals_shape(self, super_sess):
        r = super_sess.get(f"{BASE_URL}/api/super/overview", timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        totals = d.get("totals")
        assert isinstance(totals, dict)
        for f in ("grossRevenue", "platformFee", "companyNet", "completedTrips", "cancellations30d"):
            assert f in totals, f"totals.{f} missing: {totals}"

    def test_super_overview_per_company_includes_commission_data(self, super_sess):
        # Ensure a fresh company is in the list
        co = _register_company("BIG")
        r = super_sess.get(f"{BASE_URL}/api/super/overview", timeout=15)
        assert r.status_code == 200
        d = r.json()
        companies = d.get("companies", [])
        assert isinstance(companies, list) and len(companies) >= 1
        # Find our newly created company
        target = next((c for c in companies if c.get("slug") == co["slug"]), None)
        assert target is not None, f"new company {co['slug']} not in list"
        assert target.get("cityTier") == "BIG"
        assert target.get("commissionRate") == 0.07
        assert "platformFee" in target
        assert "companyNet" in target
        assert "completedTrips" in target


# ========= (c) Cancellation – customer =========
class TestCustomerCancel:
    def test_cancel_active_booking_succeeds(self):
        b = _create_booking_no_company()
        bid = b["id"]
        # Cancel
        r = requests.post(
            f"{BASE_URL}/api/bookings/{bid}/cancel",
            json={"reason": "Plan geändert"},
            timeout=15,
        )
        assert r.status_code in (200, 201), f"cancel failed: {r.status_code} {r.text}"
        # GET back -> status STORNIERT, cancelledBy=CUSTOMER, reason set
        time.sleep(0.5)
        r2 = requests.get(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
        assert r2.status_code == 200
        body = r2.json()
        booking = body.get("booking", body)
        assert booking.get("status") == "STORNIERT", f"status not STORNIERT: {booking.get('status')}"
        assert booking.get("cancelledBy") == "CUSTOMER", f"cancelledBy: {booking.get('cancelledBy')}"
        assert booking.get("cancelReason") == "Plan geändert"
        assert booking.get("cancelledAt"), "cancelledAt missing"

    def test_cancel_non_existent_returns_404(self):
        r = requests.post(f"{BASE_URL}/api/bookings/does-not-exist/cancel", json={}, timeout=15)
        assert r.status_code == 404

    def test_cancel_already_cancelled_returns_409(self):
        b = _create_booking_no_company()
        bid = b["id"]
        r1 = requests.post(f"{BASE_URL}/api/bookings/{bid}/cancel", json={}, timeout=15)
        assert r1.status_code in (200, 201)
        r2 = requests.post(f"{BASE_URL}/api/bookings/{bid}/cancel", json={}, timeout=15)
        assert r2.status_code == 409, f"expected 409, got {r2.status_code} {r2.text}"


# ========= (c) Cancellation – admin =========
class TestAdminCancel:
    def test_admin_can_cancel_own_company_booking(self):
        co = _register_company("SMALL")
        s = co["session"]
        slug = co["slug"]
        # Create booking for this company
        payload = {
            "company": slug,
            "customerName": "TEST_AdmCancel",
            "customerPhone": "0511000",
            "pickupAddress": "HBF Hannover",
            "pickup": {"lat": 52.3759, "lng": 9.7320},
            "destAddress": "Kröpcke Hannover",
            "dest": {"lat": 52.3719, "lng": 9.7385},
            "paymentMethod": "CASH",
        }
        r = _post_booking(payload)
        assert r.status_code in (200, 201)
        bid = r.json().get("booking", r.json()).get("id") or r.json().get("id")
        # Admin cancels
        r2 = s.post(
            f"{BASE_URL}/api/admin/bookings/{bid}/cancel",
            json={"reason": "Test admin"},
            timeout=15,
        )
        assert r2.status_code in (200, 201), f"admin cancel failed: {r2.status_code} {r2.text}"
        # Verify
        r3 = requests.get(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
        booking = r3.json().get("booking", r3.json())
        assert booking.get("status") == "STORNIERT"
        assert booking.get("cancelledBy") == "ADMIN"

    def test_admin_cannot_cancel_other_companys_booking(self):
        co_a = _register_company("SMALL")
        co_b = _register_company("SMALL")
        # Booking belongs to company B
        payload = {
            "company": co_b["slug"],
            "customerName": "TEST_X",
            "customerPhone": "05110",
            "pickupAddress": "HBF Hannover",
            "pickup": {"lat": 52.3759, "lng": 9.7320},
            "destAddress": "Kröpcke Hannover",
            "dest": {"lat": 52.3719, "lng": 9.7385},
            "paymentMethod": "CASH",
        }
        r = _post_booking(payload)
        bid = r.json().get("booking", r.json()).get("id") or r.json().get("id")
        # admin A tries to cancel
        r2 = co_a["session"].post(
            f"{BASE_URL}/api/admin/bookings/{bid}/cancel", json={}, timeout=15
        )
        assert r2.status_code == 403, f"expected 403, got {r2.status_code} {r2.text}"

    def test_admin_cancel_requires_auth(self):
        b = _create_booking_no_company()
        bid = b["id"]
        r = requests.post(f"{BASE_URL}/api/admin/bookings/{bid}/cancel", json={}, timeout=15)
        assert r.status_code in (401, 403)


# ========= (c) Cancellation log endpoint =========
class TestCancellationLog:
    def test_admin_can_read_cancellation_log(self):
        co = _register_company("SMALL")
        s = co["session"]
        slug = co["slug"]
        payload = {
            "company": slug,
            "customerName": "TEST_LogReader",
            "customerPhone": "05110",
            "pickupAddress": "HBF Hannover",
            "pickup": {"lat": 52.3759, "lng": 9.7320},
            "destAddress": "Kröpcke Hannover",
            "dest": {"lat": 52.3719, "lng": 9.7385},
            "paymentMethod": "CASH",
        }
        r = _post_booking(payload)
        bid = r.json().get("booking", r.json()).get("id") or r.json().get("id")
        # cancel as admin
        r2 = s.post(
            f"{BASE_URL}/api/admin/bookings/{bid}/cancel",
            json={"reason": "log-test"},
            timeout=15,
        )
        assert r2.status_code in (200, 201)
        # read log
        r3 = s.get(f"{BASE_URL}/api/admin/bookings/{bid}/cancellations", timeout=15)
        assert r3.status_code == 200, f"log get failed: {r3.status_code} {r3.text}"
        logs = r3.json().get("logs", [])
        assert isinstance(logs, list)
        assert len(logs) >= 1
        entry = logs[0]
        assert entry.get("actorType") == "ADMIN"
        assert entry.get("bookingId") == bid


# ========= Quick win: GET /api/bookings/:id returns flat + wrapped =========
class TestUnifiedShape:
    def test_get_booking_returns_flat_and_wrapped(self):
        b = _create_booking_no_company()
        bid = b["id"]
        r = requests.get(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
        assert r.status_code == 200
        d = r.json()
        # flat keys
        assert d.get("id") == bid
        assert "status" in d
        # wrapped
        assert "booking" in d
        assert d["booking"].get("id") == bid


# ========= (d) priceExact field present in DTO =========
class TestPriceExactField:
    def test_booking_dto_includes_priceExact_initially_null(self):
        b = _create_booking_no_company()
        # priceExact field present, initially null
        assert "priceExact" in b
        assert b.get("priceExact") in (None, 0, "")
        # priceMin/priceMax present
        assert (b.get("priceMin") or 0) > 0
        assert (b.get("priceMax") or 0) > 0

    def test_booking_dto_includes_isReserved_and_commission_fields(self):
        b = _create_booking_no_company()
        for f in ("isReserved", "platformFee", "companyNet", "platformFeeRate", "cancelledAt", "cancelledBy", "cancelReason"):
            assert f in b, f"DTO missing field: {f}"
        assert b.get("isReserved") in (False, 0)
