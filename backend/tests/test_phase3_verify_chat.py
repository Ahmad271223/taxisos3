"""Iteration 8 – TaxiOS v2.0 Phase 3 tests.

Covers:
 h) Gast-Verifizierung – /api/verify/request + /api/verify/confirm (Mock-devCode),
    Pflicht vor Dispatch in POST /api/bookings (403 ohne/mit falschem Token).
 i) Live-Chat – GET /api/bookings/:id/messages (REST-Verlauf). Der Socket-
    Sende-/Empfangs-Pfad wird vom Node-E2E (scripts/e2e_*) abgedeckt.

Hinweis: conftest.py injiziert fuer ALLE anderen Booking-POSTs automatisch ein
Verifizierungs-Token (Mock-Flow), damit die Phase-1/2-Regression gruen bleibt.
Die Negativ-Tests hier setzen `_noverify=True`, um den 403-Pfad zu pruefen.
"""
import os
import time
import random
import string
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://taxios-dispatch.preview.emergentagent.com"
).rstrip("/")

HBF = {"lat": 52.3759, "lng": 9.7320}
KROEPCKE = {"lat": 52.3719, "lng": 9.7385}


def _rand_phone():
    return "0511" + "".join(random.choices(string.digits, k=7))


def _booking_payload(phone, **extra):
    p = {
        "customerName": "TEST_P3",
        "customerPhone": phone,
        "pickupAddress": "HBF Hannover",
        "pickup": HBF,
        "destAddress": "Kröpcke",
        "dest": KROEPCKE,
        "paymentMethod": "CASH",
    }
    p.update(extra)
    return p


def _request_code(phone, channel="SMS"):
    return requests.post(
        f"{BASE_URL}/api/verify/request", json={"channel": channel, "target": phone}, timeout=15
    )


def _confirm(phone, code, channel="SMS"):
    return requests.post(
        f"{BASE_URL}/api/verify/confirm",
        json={"channel": channel, "target": phone, "code": code},
        timeout=15,
    )


def _token_for(phone):
    code = _request_code(phone).json().get("devCode")
    assert code, "no devCode (provider not in mock mode?)"
    return _confirm(phone, code).json().get("token")


# ========= (h) Verifizierung – request/confirm =========
class TestVerifyFlow:
    def test_request_returns_devcode_in_mock(self):
        r = _request_code(_rand_phone())
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        assert d.get("ok") is True
        assert d.get("mock") is True, "expected mock mode locally"
        assert d.get("devCode") and len(d["devCode"]) == 6
        assert d.get("expiresAt")

    def test_confirm_correct_code_returns_token(self):
        phone = _rand_phone()
        code = _request_code(phone).json()["devCode"]
        r = _confirm(phone, code)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert r.json().get("token")

    def test_confirm_wrong_code_rejected(self):
        phone = _rand_phone()
        _request_code(phone)
        r = _confirm(phone, "000000")
        assert r.status_code == 401, f"expected 401, got {r.status_code} {r.text}"

    def test_confirm_without_request_404(self):
        r = _confirm(_rand_phone(), "123456")
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"


# ========= (h) Verifizierung – Pflicht vor Dispatch =========
class TestBookingRequiresVerification:
    def test_booking_without_token_rejected(self):
        # _noverify => conftest injiziert KEIN Token
        r = requests.post(
            f"{BASE_URL}/api/bookings", json=_booking_payload(_rand_phone(), _noverify=True), timeout=20
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
        assert r.json().get("code") == "VERIFICATION_REQUIRED"

    def test_booking_with_wrong_phone_token_rejected(self):
        token_phone = _rand_phone()
        token = _token_for(token_phone)
        other_phone = _rand_phone()
        payload = _booking_payload(other_phone, _noverify=True, verificationToken=token)
        r = requests.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)
        assert r.status_code == 403, f"token for wrong phone must fail: {r.status_code} {r.text}"

    def test_booking_with_valid_token_succeeds(self):
        phone = _rand_phone()
        token = _token_for(phone)
        payload = _booking_payload(phone, _noverify=True, verificationToken=token)
        r = requests.post(f"{BASE_URL}/api/bookings", json=payload, timeout=20)
        assert r.status_code in (200, 201), f"valid token booking failed: {r.status_code} {r.text}"
        b = r.json().get("booking", r.json())
        assert b.get("id")
        assert b.get("status") == "OFFEN"


# ========= (i) Chat – REST-Verlauf =========
class TestChatHistory:
    def test_messages_endpoint_empty_for_fresh_booking(self):
        # conftest verifiziert automatisch
        r = requests.post(f"{BASE_URL}/api/bookings", json=_booking_payload(_rand_phone()), timeout=20)
        assert r.status_code in (200, 201), r.text
        bid = r.json().get("id") or r.json().get("booking", {}).get("id")
        time.sleep(0.3)
        m = requests.get(f"{BASE_URL}/api/bookings/{bid}/messages", timeout=15)
        assert m.status_code == 200, f"{m.status_code} {m.text}"
        assert m.json().get("messages") == []

    def test_messages_endpoint_404_for_unknown_booking(self):
        m = requests.get(f"{BASE_URL}/api/bookings/does-not-exist/messages", timeout=15)
        assert m.status_code == 404
