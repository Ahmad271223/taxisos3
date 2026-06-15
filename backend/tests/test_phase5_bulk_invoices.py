"""Iteration 10 – TaxiOS Phase 5: Sammel-Abrechnung + E-Mail-Versand.

Covers GET /api/super/invoices/<YYYY-MM> (Super-Admin):
  - Auth (401 ohne Super-Session; Firmen-Admin abgelehnt), bad month 400
  - ?format=json -> Aggregat-Form (companies/billable/totals/rows)
  - ZIP-Download: application/zip + PK-Magic
und POST .../send (Super) + POST /api/admin/invoices/<month>/send (Firma):
  - Versand-Zusammenfassung; im Mock-Modus (kein Resend-Key) mock=True.

Der ZIP-INHALT (PDFs je Firma + CSV) wird vom Node-E2E scripts/e2e_bulk_invoice.js
geprueft (entpackt + validiert die enthaltenen PDFs).
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

SUPER_EMAIL = "super@taxios.app"
SUPER_PASS = "SuperAdmin2026!"
CURRENT_MONTH = time.strftime("%Y-%m")
EMPTY_PAST_MONTH = "2019-03"


def _rand(n=4):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _super():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": SUPER_EMAIL, "password": SUPER_PASS, "role": "ADMIN"},
        timeout=20,
    )
    assert r.status_code == 200, f"super login: {r.status_code} {r.text}"
    return s


def _company():
    ts = int(time.time() * 1000)
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/companies/register",
        json={"name": f"TEST_Bulk_{ts}_{_rand()}", "email": f"bulk+{ts}{_rand()}@test.com", "password": "Pass1234"},
        timeout=25,
    )
    assert r.status_code in (200, 201)
    return s


class TestBulkAuth:
    def test_zip_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/super/invoices/{CURRENT_MONTH}", timeout=20)
        assert r.status_code == 401

    def test_company_admin_forbidden(self):
        co = _company()
        r = co.get(f"{BASE_URL}/api/super/invoices/{CURRENT_MONTH}?format=json", timeout=20)
        assert r.status_code == 401, f"company admin must not access super route: {r.status_code}"

    def test_bad_month_400(self):
        s = _super()
        r = s.get(f"{BASE_URL}/api/super/invoices/2026-13?format=json", timeout=20)
        assert r.status_code == 400


class TestBulkJson:
    def test_summary_shape(self):
        s = _super()
        r = s.get(f"{BASE_URL}/api/super/invoices/{CURRENT_MONTH}?format=json", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        d = r.json()
        for k in ("month", "companies", "billable", "totals", "rows"):
            assert k in d, f"missing {k}"
        for k in ("net", "vat", "gross"):
            assert k in d["totals"]
        assert isinstance(d["rows"], list)
        assert d["month"] == CURRENT_MONTH
        # totals.gross ~= net + vat (Rundung)
        assert abs(d["totals"]["gross"] - (d["totals"]["net"] + d["totals"]["vat"])) < 0.05


class TestBulkZip:
    def test_zip_download(self):
        s = _super()
        r = s.get(f"{BASE_URL}/api/super/invoices/{CURRENT_MONTH}", timeout=60)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert "application/zip" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "")
        assert r.content[:4] == b"PK\x03\x04", f"not a zip: {r.content[:8]!r}"


class TestBulkSend:
    def test_super_send_all_summary(self):
        s = _super()
        r = s.post(f"{BASE_URL}/api/super/invoices/{CURRENT_MONTH}/send", timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        d = r.json()
        for k in ("attempted", "sent", "failed", "results"):
            assert k in d, f"missing {k}"
        assert d["sent"] == d["attempted"] and d["failed"] == 0
        if d["attempted"] > 0:
            assert d["mock"] is True  # lokal kein Resend-Key -> Mock

    def test_admin_send_own(self):
        co = _company()
        r = co.post(f"{BASE_URL}/api/admin/invoices/{EMPTY_PAST_MONTH}/send", timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        assert d.get("ok") is True
        assert d.get("mock") is True  # Mock-Modus

    def test_admin_send_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/admin/invoices/{EMPTY_PAST_MONTH}/send", timeout=20)
        assert r.status_code == 401
