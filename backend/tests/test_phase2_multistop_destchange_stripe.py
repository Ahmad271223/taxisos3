"""Iteration 7 – TaxiOS v2.0 Phase 2 tests.

Covers:
 e) Mehrziel-Vorabplanung  – /api/quote + /api/bookings mit `stops` (Gesamtpreis).
 f) Zieländerung während der Fahrt – POST /api/bookings/:id/destination
    (neues Ziel + Zwischenstopp, automatische Neuberechnung, Sperre nach Abschluss).
 g) Stripe Authorize-then-Capture – Karten-Buchung wird autorisiert; Stornierung
    gibt die Autorisierung frei. (Capture nach Fahrtende benoetigt einen Fahrer-
    Socket-Client und liegt ausserhalb des pytest-Scopes.)

Hinweis: Laeuft ohne STRIPE_SECRET_KEY im Mock-Modus – die Statusuebergaenge
(AUTORISIERT/STORNIERT) sind identisch zum echten Stripe-Test-Key, daher sind die
Assertions in beiden Faellen stabil.
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

# Hannover-Referenzpunkte
HBF = {"lat": 52.3759, "lng": 9.7320}            # Hauptbahnhof
KROEPCKE = {"lat": 52.3719, "lng": 9.7385}       # Kröpcke (~1 km)
AIRPORT = {"lat": 52.4611, "lng": 9.6850}        # Flughafen (~10 km)
DETOUR = {"lat": 52.4000, "lng": 9.8000}         # Umweg Nord-Ost


def _rand(n=6):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _post_booking(payload):
    return requests.post(f"{BASE_URL}/api/bookings", json=payload, timeout=25)


def _base_payload(**extra):
    p = {
        "customerName": f"TEST_{_rand()}",
        "customerPhone": "0511000",
        "pickupAddress": "HBF Hannover",
        "pickup": HBF,
        "destAddress": "Kröpcke Hannover",
        "dest": KROEPCKE,
        "paymentMethod": "CASH",
    }
    p.update(extra)
    return p


def _create_booking(**extra):
    r = _post_booking(_base_payload(**extra))
    assert r.status_code in (200, 201), f"booking failed: {r.status_code} {r.text}"
    return r.json().get("booking", r.json())


def _get_booking(bid):
    r = requests.get(f"{BASE_URL}/api/bookings/{bid}", timeout=15)
    assert r.status_code == 200, f"get failed: {r.status_code} {r.text}"
    body = r.json()
    return body.get("booking", body)


# ========= (e) Mehrziel – Quote =========
class TestMultiStopQuote:
    def test_quote_with_stop_increases_distance_and_price(self):
        direct = requests.post(
            f"{BASE_URL}/api/quote", json={"from": HBF, "to": KROEPCKE}, timeout=20
        ).json()
        via = requests.post(
            f"{BASE_URL}/api/quote",
            json={"from": HBF, "to": KROEPCKE, "stops": [{"address": "Umweg", **DETOUR}]},
            timeout=20,
        ).json()
        assert via.get("distanceMeters", 0) > direct.get("distanceMeters", 0), (
            f"detour not longer: {via} vs {direct}"
        )
        assert via.get("priceMax", 0) >= direct.get("priceMax", 0)

    def test_quote_without_stops_still_works(self):
        r = requests.post(f"{BASE_URL}/api/quote", json={"from": HBF, "to": KROEPCKE}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d.get("priceMin", 0) > 0 and d.get("priceMax", 0) > 0


# ========= (e) Mehrziel – Booking =========
class TestMultiStopBooking:
    def test_booking_with_stops_persisted(self):
        b = _create_booking(stops=[{"address": "Mittelstopp", "lat": 52.3800, "lng": 9.7500}])
        stops = b.get("stops")
        assert isinstance(stops, list) and len(stops) == 1, f"stops not persisted: {stops}"
        assert stops[0]["address"] == "Mittelstopp"
        # Erneut laden -> weiterhin vorhanden
        bk = _get_booking(b["id"])
        assert len(bk.get("stops", [])) == 1

    def test_booking_without_stops_has_empty_list(self):
        b = _create_booking()
        assert b.get("stops") == []


# ========= (f) Zieländerung – neues Ziel =========
class TestDestinationChange:
    def test_change_destination_recomputes_price(self):
        b = _create_booking()
        bid = b["id"]
        old_max = b.get("priceMax") or 0
        r = requests.post(
            f"{BASE_URL}/api/bookings/{bid}/destination",
            json={"dest": {"address": "Flughafen Hannover", **AIRPORT}},
            timeout=25,
        )
        assert r.status_code in (200, 201), f"change failed: {r.status_code} {r.text}"
        body = r.json().get("booking", {})
        assert body.get("destAddress") == "Flughafen Hannover"
        assert (body.get("destChangeCount") or 0) >= 1
        assert (body.get("priceMax") or 0) > old_max, "price not recomputed upward"
        # Persistiert?
        bk = _get_booking(bid)
        assert bk.get("destAddress") == "Flughafen Hannover"

    def test_add_stop_appends_waypoint(self):
        b = _create_booking()
        bid = b["id"]
        r = requests.post(
            f"{BASE_URL}/api/bookings/{bid}/destination",
            json={"addStop": {"address": "Aegidientorplatz", "lat": 52.3680, "lng": 9.7450}},
            timeout=25,
        )
        assert r.status_code in (200, 201), f"addStop failed: {r.status_code} {r.text}"
        body = r.json().get("booking", {})
        stops = body.get("stops")
        assert isinstance(stops, list) and len(stops) == 1
        assert stops[0]["address"] == "Aegidientorplatz"

    def test_change_requires_payload(self):
        b = _create_booking()
        r = requests.post(f"{BASE_URL}/api/bookings/{b['id']}/destination", json={}, timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"

    def test_change_non_existent_404(self):
        r = requests.post(
            f"{BASE_URL}/api/bookings/does-not-exist/destination",
            json={"dest": {"address": "X", **AIRPORT}},
            timeout=15,
        )
        assert r.status_code == 404

    def test_change_blocked_after_cancel(self):
        b = _create_booking()
        bid = b["id"]
        c = requests.post(f"{BASE_URL}/api/bookings/{bid}/cancel", json={}, timeout=15)
        assert c.status_code in (200, 201)
        r = requests.post(
            f"{BASE_URL}/api/bookings/{bid}/destination",
            json={"dest": {"address": "X", **AIRPORT}},
            timeout=15,
        )
        assert r.status_code == 409, f"expected 409, got {r.status_code} {r.text}"


# ========= (g) Stripe Authorize-then-Capture =========
class TestStripeAuthorize:
    def test_card_booking_is_authorized(self):
        b = _create_booking(paymentMethod="CARD")
        assert b.get("paymentMethod") == "CARD"
        assert b.get("paymentStatus") == "AUTORISIERT", f"not authorized: {b.get('paymentStatus')}"
        assert (b.get("priceAuthorized") or 0) > 0, "no hold amount stored"

    def test_cash_booking_not_authorized(self):
        b = _create_booking(paymentMethod="CASH")
        assert b.get("paymentStatus") == "OFFEN"
        assert b.get("priceAuthorized") in (None, 0)

    def test_card_cancel_voids_authorization(self):
        b = _create_booking(paymentMethod="CARD")
        bid = b["id"]
        assert b.get("paymentStatus") == "AUTORISIERT"
        c = requests.post(f"{BASE_URL}/api/bookings/{bid}/cancel", json={"reason": "void"}, timeout=15)
        assert c.status_code in (200, 201)
        time.sleep(0.5)
        bk = _get_booking(bid)
        assert bk.get("paymentStatus") == "STORNIERT", f"auth not voided: {bk.get('paymentStatus')}"


# ========= DTO-Form (Phase 2 Felder) =========
class TestPhase2DTO:
    def test_dto_includes_phase2_fields(self):
        b = _create_booking()
        for f in ("stops", "priceAuthorized", "destChangeCount", "destChangedAt"):
            assert f in b, f"DTO missing field: {f}"
        assert isinstance(b.get("stops"), list)
        assert b.get("destChangeCount") in (0,)
