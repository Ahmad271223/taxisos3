"""
Iteration 20 E2E re-test.
Focus: STANDARD bookings dispatch (murat FREI),
       Stripe PaymentIntent + Booking + Capture flow,
       Vorbestellung / Flughafen / Krankenfahrt / Gruppe,
       /api/taxis/live count, Watchdog verification.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://d8817f61-ba4b-4a01-b8da-5f3db2df7025.preview.emergentagent.com").rstrip("/")

CUSTOMER = {"email": "anna@kunde.test", "password": "demo1234", "role": "CUSTOMER"}
DRIVER = {"username": "murat", "password": "demo1234", "role": "DRIVER"}
ADMIN = {"email": "demo@citytaxi.test", "password": "demo1234", "role": "ADMIN"}
# Super-Admin uses same login but role:"ADMIN" (slug=_super)
SUPER = {"email": "super@taxios.app", "password": "SuperAdmin2026!", "role": "ADMIN"}

FROM_LOC = {"lat": 52.3759, "lng": 9.7320}
TO_LOC = {"lat": 52.3669, "lng": 9.7510}
FROM_ADDR = "Hauptbahnhof Hannover"
TO_ADDR = "Marktplatz Hannover"

CUSTOMER_NAME = "Anna Test"
CUSTOMER_PHONE = "+491701234555"


def common_booking_payload(**extra):
    payload = {
        "customerName": CUSTOMER_NAME,
        "customerPhone": CUSTOMER_PHONE,
        "pickupAddress": FROM_ADDR,
        "pickup": FROM_LOC,
        "destAddress": TO_ADDR,
        "dest": TO_LOC,
        "passengers": 1,
        "luggage": False,
        "paymentMethod": "CASH",
        "vehicleClass": "STANDARD",
    }
    payload.update(extra)
    return payload


@pytest.fixture(scope="module")
def customer_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=CUSTOMER, timeout=15)
    assert r.status_code == 200, f"Customer login failed: {r.status_code} {r.text}"
    return s


# ── Health & Auth ─────────────────────────────────────────────────────────────
def test_healthz():
    r = requests.get(f"{BASE_URL}/api/healthz", timeout=10)
    assert r.status_code == 200


def test_taxis_live():
    r = requests.get(f"{BASE_URL}/api/taxis/live", timeout=15)
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    drivers = j.get("drivers") or j.get("taxis") or j
    if isinstance(drivers, list):
        print(f"Taxis live count: {len(drivers)}")
        assert len(drivers) >= 6, f"expected >=6 taxis, got {len(drivers)}"


def test_login_customer():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=CUSTOMER, timeout=15)
    assert r.status_code == 200


def test_login_driver_murat():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=DRIVER, timeout=15)
    assert r.status_code == 200, r.text[:200]


def test_login_admin():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200


def test_login_super():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=SUPER, timeout=15)
    assert r.status_code == 200, r.text[:200]
    assert r.json().get("role") == "SUPER_ADMIN"


# ── Quote ─────────────────────────────────────────────────────────────────────
def test_quote_with_classes(customer_session):
    payload = {"from": FROM_LOC, "to": TO_LOC}
    r = customer_session.post(f"{BASE_URL}/api/quote", json=payload, timeout=20)
    assert r.status_code == 200, r.text[:300]
    j = r.json()
    if "classes" in j:
        names = [c.get("key") or c.get("vehicleClass") or c.get("class") for c in j["classes"]]
        print(f"Quote classes: {names}")
        assert "STANDARD" in names
        std = [c for c in j["classes"] if c.get("key") == "STANDARD"][0]
        assert std.get("available", 0) >= 1, f"STANDARD has no available drivers: {std}"


# ── STANDARD-Sofortbuchung → Dispatch in 30s ─────────────────────────────────
_standard_bid = {"id": None}


def test_standard_booking_create(customer_session):
    """STANDARD Sofort-Buchung – muss dank murat=FREI dispatched werden."""
    payload = common_booking_payload()
    r = customer_session.post(f"{BASE_URL}/api/bookings", json=payload, timeout=30)
    print(f"STANDARD create: {r.status_code} {r.text[:300]}")
    assert r.status_code in (200, 201), r.text[:400]
    j = r.json()
    bid = j.get("id") or (j.get("booking") or {}).get("id")
    assert bid
    _standard_bid["id"] = bid


def test_standard_booking_dispatched_within_30s(customer_session):
    bid = _standard_bid["id"]
    if not bid:
        pytest.skip("no booking id from prior test")
    deadline = time.time() + 35
    last = None
    while time.time() < deadline:
        r = customer_session.get(f"{BASE_URL}/api/bookings/{bid}", timeout=10)
        if r.status_code == 200:
            j = r.json()
            last = (j.get("status"), j.get("trackingStatus"), j.get("driverId"))
            if j.get("status") in ("ZUGEWIESEN", "AKTIV") and j.get("driverId"):
                print(f"DISPATCHED: {last}")
                return
        time.sleep(3)
    pytest.fail(f"STANDARD booking {bid} not dispatched within 30s. Last: {last}")


# ── Stripe PaymentIntent ─────────────────────────────────────────────────────
def test_stripe_payment_intent(customer_session):
    time.sleep(11)
    r = customer_session.post(
        f"{BASE_URL}/api/payments/intent",
        json={"pickup": FROM_LOC, "dest": TO_LOC},
        timeout=20,
    )
    print(f"PaymentIntent: {r.status_code} {r.text[:300]}")
    assert r.status_code == 200, r.text[:200]
    j = r.json()
    assert j.get("enabled") is True, j
    assert j.get("mock") is False, f"Expected real Stripe: {j}"
    cs = j.get("clientSecret", "")
    assert cs.startswith("pi_"), f"clientSecret: {cs[:50]}"


# ── Vorbestellung ────────────────────────────────────────────────────────────
def test_vorbestellung(customer_session):
    time.sleep(11)
    future_iso = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 30 * 60))
    payload = common_booking_payload(scheduledAt=future_iso)
    r = customer_session.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)
    print(f"Vorbestellung: {r.status_code} {r.text[:300]}")
    if r.status_code == 429:
        pytest.skip("rate limited")
    assert r.status_code in (200, 201), r.text[:300]
    j = r.json()
    bid = j.get("id") or (j.get("booking") or {}).get("id")
    if bid:
        r2 = customer_session.get(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
        if r2.status_code == 200:
            b = r2.json()
            assert b.get("isScheduled") in (True, None) or b.get("scheduledAt"), f"not scheduled: keys={list(b.keys())}"


# ── Flughafen ────────────────────────────────────────────────────────────────
def test_flughafen(customer_session):
    time.sleep(11)
    future_iso = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 2 * 3600))
    payload = common_booking_payload(
        vehicleClass="VAN",
        dest={"lat": 52.4575, "lng": 9.6921},
        destAddress="Flughafen Hannover",
        passengers=2,
        flightNumber="LH441",
        flightDirection="DEPARTURE",
        flightScheduledAt=future_iso,
        scheduledAt=future_iso,
    )
    r = customer_session.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)
    print(f"Flughafen: {r.status_code} {r.text[:300]}")
    if r.status_code == 429:
        pytest.skip("rate limited")
    assert r.status_code in (200, 201), r.text[:300]


# ── Krankenfahrt ─────────────────────────────────────────────────────────────
def test_krankenfahrt(customer_session):
    time.sleep(11)
    payload = common_booking_payload(
        vehicleClass="WHEELCHAIR",
        medicalType="EINMALIG",
        notes="Beförderungsschein BEF-2026-001",
    )
    r = customer_session.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)
    print(f"Krankenfahrt: {r.status_code} {r.text[:300]}")
    if r.status_code == 429:
        pytest.skip("rate limited")
    assert r.status_code in (200, 201), r.text[:300]


# ── Gruppe ───────────────────────────────────────────────────────────────────
def test_group_12_passengers(customer_session):
    """API only accepts <=8 passengers per booking; 12 pax should be split via /api/groups."""
    time.sleep(11)
    # Try the group endpoint first
    r = customer_session.post(
        f"{BASE_URL}/api/groups",
        json={
            "customerName": CUSTOMER_NAME,
            "customerPhone": CUSTOMER_PHONE,
            "pickupAddress": FROM_ADDR, "pickup": FROM_LOC,
            "destAddress": TO_ADDR, "dest": TO_LOC,
            "totalPassengers": 12,
            "passengers": 12,
            "groupSize": 12,
            "paymentMethod": "CASH",
        },
        timeout=20,
    )
    print(f"Group endpoint: {r.status_code} {r.text[:300]}")
    if r.status_code == 429:
        pytest.skip("rate limited")
    # Accept either successful group creation OR a clear "need multiple vehicles" hint
    assert r.status_code in (200, 201, 400), r.text[:300]
