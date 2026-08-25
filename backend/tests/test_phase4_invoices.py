"""Iteration 9 – TaxiOS Phase 4 tests: monatliche Provisions-Rechnung.

Covers GET /api/admin/invoices/<YYYY-MM>:
  - Auth (401 ohne Session), Mandantentrennung (403 fremde companyId)
  - ?format=json -> Rechnungsdaten-Form + USt-Mathematik (leerer Monat: 0)
  - PDF-Download: Content-Type application/pdf + %PDF-Magic

Der Pfad MIT Fahrten (Zeile, 7%/5%-Satz, net=summe) wird vom Node-E2E
scripts/e2e_invoice.js abgedeckt (benoetigt einen Fahrer-Socket zum Abschluss).
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


def _rand(n=4):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _register_company(city_tier="SMALL"):
    ts = int(time.time() * 1000)
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/companies/register",
        json={
            "name": f"TEST_Inv_{ts}_{_rand()}",
            "email": f"inv+{ts}{_rand()}@test.com",
            "password": TEST_PASSWORT,
            "cityTier": city_tier,
        },
        timeout=25,
    )
    assert r.status_code in (200, 201), f"register: {r.status_code} {r.text}"
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=15).json()
    return {"session": s, "companyId": me.get("session", {}).get("companyId")}


CURRENT_MONTH = time.strftime("%Y-%m")
EMPTY_PAST_MONTH = "2020-01"


class TestInvoiceAuth:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/invoices/{CURRENT_MONTH}", timeout=15)
        assert r.status_code == 401, f"expected 401, got {r.status_code}"

    def test_cross_company_forbidden(self):
        a = _register_company()
        b = _register_company()
        # Admin A versucht, mit B's companyId abzurechnen
        r = a["session"].get(
            f"{BASE_URL}/api/admin/invoices/{CURRENT_MONTH}?format=json&companyId={b['companyId']}",
            timeout=15,
        )
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


class TestInvoiceJson:
    def test_bad_month_rejected(self):
        co = _register_company()
        r = co["session"].get(f"{BASE_URL}/api/admin/invoices/2026-13?format=json", timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"

    def test_empty_month_shape_and_vat_math(self):
        co = _register_company("BIG")
        r = co["session"].get(f"{BASE_URL}/api/admin/invoices/{EMPTY_PAST_MONTH}?format=json", timeout=15)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        for f in ("invoiceNo", "periodLabel", "monthKey", "issuer", "recipient", "lines", "trips", "net", "vat", "gross", "vatRate"):
            assert f in d, f"missing field {f}: {d}"
        assert d["trips"] == 0 and d["lines"] == []
        assert d["net"] == 0 and d["vat"] == 0 and d["gross"] == 0
        # USt-Mathematik (auch bei 0 konsistent)
        assert round(d["net"] * d["vatRate"], 2) == d["vat"]
        assert round(d["net"] + d["vat"], 2) == d["gross"]
        assert d["monthKey"] == EMPTY_PAST_MONTH
        assert d["recipient"]["ratePct"] == 7  # BIG
        assert d["issuer"]["name"]

    def test_invoice_number_is_deterministic(self):
        co = _register_company()
        u = f"{BASE_URL}/api/admin/invoices/{EMPTY_PAST_MONTH}?format=json"
        a = co["session"].get(u, timeout=15).json()["invoiceNo"]
        b = co["session"].get(u, timeout=15).json()["invoiceNo"]
        assert a == b and a.startswith("RE-202001-"), a


class TestInvoicePdf:
    def test_pdf_download_content_type_and_magic(self):
        co = _register_company()
        r = co["session"].get(f"{BASE_URL}/api/admin/invoices/{EMPTY_PAST_MONTH}", timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert "application/pdf" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "")
        assert r.content[:5] == b"%PDF-", f"not a PDF: {r.content[:16]!r}"
        assert len(r.content) > 800
