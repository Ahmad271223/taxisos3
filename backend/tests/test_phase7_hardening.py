"""Iteration 12 – Produktions-Härtung: Rate-Limiting.

Die Limits greifen nur, wenn ein X-Forwarded-For-Header vorhanden ist (im Pod
hinter dem Proxy = ja). Lokale Direkt-Tests ohne den Header werden NICHT
limitiert – das wird hier ebenfalls geprüft.
"""
import os
import random
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://taxios-dispatch.preview.emergentagent.com"
).rstrip("/")


def _ip():
    # TEST-NET-3 (RFC 5737), je Test frisch -> eigener Rate-Limit-Bucket
    return f"203.0.{random.randint(1, 254)}.{random.randint(1, 254)}"


def _phone():
    return "+49151" + str(random.randint(1000000, 9999999))


class TestVerifyRateLimit:
    def test_per_target_limited_with_xff(self):
        ip, phone = _ip(), _phone()
        codes = []
        for _ in range(7):
            r = requests.post(
                f"{BASE_URL}/api/verify/request",
                json={"channel": "SMS", "target": phone},
                headers={"X-Forwarded-For": ip},
                timeout=15,
            )
            codes.append(r.status_code)
        assert codes[:5] == [200] * 5, f"erste 5 sollten 200 sein: {codes}"
        assert 429 in codes[5:], f"kein 429 nach 5 Anfragen: {codes}"

    def test_not_limited_without_xff(self):
        phone = _phone()
        oks = 0
        for _ in range(8):
            r = requests.post(
                f"{BASE_URL}/api/verify/request",
                json={"channel": "SMS", "target": phone},
                timeout=15,
            )
            if r.status_code == 200:
                oks += 1
        assert oks == 8, f"ohne XFF darf nicht limitiert werden (oks={oks})"


class TestLoginRateLimit:
    def test_login_brute_force_limited_with_xff(self):
        ip = _ip()
        idr = f"nobody{random.randint(100000, 999999)}@example.com"
        codes = []
        for _ in range(23):
            r = requests.post(
                f"{BASE_URL}/api/auth/login",
                json={"email": idr, "password": "wrong-pass", "role": "ADMIN"},
                headers={"X-Forwarded-For": ip},
                timeout=15,
            )
            codes.append(r.status_code)
        assert 401 in codes[:20], f"falsche Credentials sollten zuerst 401 geben: {codes[:5]}"
        assert 429 in codes, f"Brute-Force sollte 429 auslösen: {codes}"
