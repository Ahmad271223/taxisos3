"""Iteration 4 – platform-wide booking (no company), nullable companyId, default pricing."""
import os
import time
import pytest
import requests

# Testpasswort NICHT im Repository hinterlegen – es landet sonst dauerhaft
# im Git-Verlauf. Ueber die Umgebung setzen.
TEST_PASSWORT = os.environ.get("QA_TEST_PASSWORT", "Pass!QA-2026")

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or
            "https://taxios-dispatch.preview.emergentagent.com").rstrip("/")


def _post_booking(payload):
    return requests.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)


# Booking without company slug
class TestPlatformBookingNoCompany:
    def test_create_booking_without_company_succeeds(self):
        payload = {
            "customerName": "TEST_Platform",
            "customerPhone": "0511555",
            "pickupAddress": "Hauptbahnhof Hannover",
            "pickup": {"lat": 52.3759, "lng": 9.7320},
            "destAddress": "Kröpcke Hannover",
            "dest": {"lat": 52.3719, "lng": 9.7385},
            "paymentMethod": "CASH",
        }
        r = _post_booking(payload)
        assert r.status_code in (200, 201), f"booking failed: {r.status_code} {r.text}"
        data = r.json()
        b = data.get("booking", data)
        assert b.get("id")
        # Default pricing applied
        assert (b.get("priceMin") or 0) > 0, f"priceMin not positive: {b}"
        assert (b.get("priceMax") or 0) > 0, f"priceMax not positive: {b}"
        assert b.get("status") == "OFFEN", f"unexpected status: {b.get('status')}"
        assert b.get("trackingStatus") == "SUCHE", f"unexpected trackingStatus: {b.get('trackingStatus')}"
        assert b.get("paymentMethod") == "CASH"
        # companyId may be null
        assert b.get("companyId") in (None, "") or "companyId" not in b

    def test_get_booking_without_company_returns_data(self):
        payload = {
            "customerName": "TEST_GET",
            "customerPhone": "0511444",
            "pickupAddress": "HBF Hannover",
            "pickup": {"lat": 52.3759, "lng": 9.7320},
            "destAddress": "Kröpcke Hannover",
            "dest": {"lat": 52.3719, "lng": 9.7385},
            "paymentMethod": "CASH",
        }
        r = _post_booking(payload)
        assert r.status_code in (200, 201)
        bid = r.json().get("booking", r.json()).get("id") or r.json().get("id")
        assert bid
        time.sleep(0.5)
        r2 = requests.get(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
        assert r2.status_code == 200
        body = r2.json()
        b = body.get("booking", body)
        assert b.get("id") == bid
        # companyId may be null – that's allowed
        assert b.get("companyId") in (None, "", None)

    def test_create_scheduled_booking_without_company(self):
        payload = {
            "customerName": "TEST_Scheduled",
            "customerPhone": "0511333",
            "pickupAddress": "HBF Hannover",
            "pickup": {"lat": 52.3759, "lng": 9.7320},
            "destAddress": "Kröpcke Hannover",
            "dest": {"lat": 52.3719, "lng": 9.7385},
            "paymentMethod": "CASH",
            "isScheduled": True,
            "scheduledAt": "2026-12-31T10:00:00.000Z",
        }
        r = _post_booking(payload)
        assert r.status_code in (200, 201), f"scheduled failed: {r.status_code} {r.text}"
        b = r.json().get("booking", r.json())
        assert b.get("isScheduled") in (True, 1)


# Backward compat: booking WITH company slug still works
class TestBackwardCompatWithCompany:
    @pytest.fixture(scope="class")
    def company_slug(self):
        ts = int(time.time())
        s = requests.Session()
        payload = {
            "name": f"TEST_Compat_{ts}",
            "email": f"compat+{ts}@test.com",
            "password": TEST_PASSWORT,
            "address": "Teststraße 1",
            "phone": "0511 1",
        }
        r = s.post(f"{BASE_URL}/api/companies/register", json=payload, timeout=25)
        assert r.status_code in (200, 201), f"register: {r.status_code} {r.text}"
        d = r.json()
        slug = d.get("slug") or d.get("company", {}).get("slug")
        assert slug
        return slug

    def test_booking_with_company_slug_still_works(self, company_slug):
        payload = {
            "company": company_slug,
            "customerName": "TEST_Compat",
            "customerPhone": "0511222",
            "pickupAddress": "HBF Hannover",
            "pickup": {"lat": 52.3759, "lng": 9.7320},
            "destAddress": "Kröpcke Hannover",
            "dest": {"lat": 52.3719, "lng": 9.7385},
            "paymentMethod": "CASH",
        }
        r = _post_booking(payload)
        assert r.status_code in (200, 201), f"backward compat broken: {r.status_code} {r.text}"
        b = r.json().get("booking", r.json())
        assert b.get("id")
        assert (b.get("priceMin") or 0) > 0


# Super admin still functional
class TestSuperAdminLogin:
    def test_super_login_works(self):
        s = requests.Session()
        r = s.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "super@taxios.app", "password": os.environ.get("SUPER_ADMIN_PASSWORD", ""), "role": "ADMIN"},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json().get("role") == "SUPER_ADMIN"
        r2 = s.get(f"{BASE_URL}/api/super/overview", timeout=15)
        assert r2.status_code == 200
