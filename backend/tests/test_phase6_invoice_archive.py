"""Iteration 11 – TaxiOS Phase 6: Rechnungs-Archiv + Mahnungen + Zahlungsabgleich.

Covers (Form/Auth/Validierung – ohne Fahrt):
  - GET /api/admin/invoices (eigenes Archiv; 401 ohne Auth)
  - POST /api/admin/invoices/<month>/issue: 400 ohne abrechenbare Fahrten, 400 bad month
  - GET /api/super/invoices (Liste + totals; Firmen-Admin 401)
  - POST /api/super/invoices {issue-all|remind-overdue} (Summary)
  - POST /api/super/invoices/id/<id> (404 unbekannt; bad action 400)

Den vollen Geld-Lebenszyklus (issue -> überfällig -> Mahnung -> bezahlt, mit
PDF-Stempel) deckt das Node-E2E scripts/e2e_invoice_archive.js ab.
"""
import os
import time
import random
import string
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://5edd2c00-4649-42ac-89e2-a6ce5e73bc02.preview.emergentagent.com"
).rstrip("/")

SUPER_EMAIL = "super@taxios.app"
SUPER_PASS = "SuperAdmin2026!"
CURRENT_MONTH = time.strftime("%Y-%m")


def _rand(n=4):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _super():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PASS, "role": "ADMIN"}, timeout=20)
    assert r.status_code == 200
    return s


def _company():
    ts = int(time.time() * 1000)
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/companies/register",
        json={"name": f"TEST_Arch_{ts}_{_rand()}", "email": f"arch+{ts}{_rand()}@test.com", "password": "Pass1234"},
        timeout=25,
    )
    assert r.status_code in (200, 201)
    return s


class TestArchiveAuth:
    def test_admin_archive_requires_auth(self):
        assert requests.get(f"{BASE_URL}/api/admin/invoices", timeout=15).status_code == 401

    def test_admin_archive_empty_for_new_company(self):
        co = _company()
        r = co.get(f"{BASE_URL}/api/admin/invoices", timeout=15)
        assert r.status_code == 200
        assert r.json().get("invoices") == []

    def test_super_list_forbidden_for_company_admin(self):
        co = _company()
        assert co.get(f"{BASE_URL}/api/super/invoices", timeout=15).status_code == 401


class TestIssueValidation:
    def test_issue_without_trips_rejected(self):
        co = _company()
        r = co.post(f"{BASE_URL}/api/admin/invoices/2021-05/issue", timeout=20)
        assert r.status_code == 400, f"{r.status_code} {r.text}"

    def test_issue_bad_month(self):
        co = _company()
        r = co.post(f"{BASE_URL}/api/admin/invoices/2026-13/issue", timeout=20)
        assert r.status_code == 400

    def test_issue_requires_auth(self):
        assert requests.post(f"{BASE_URL}/api/admin/invoices/{CURRENT_MONTH}/issue", timeout=15).status_code == 401


class TestSuperArchive:
    def test_list_shape(self):
        s = _super()
        r = s.get(f"{BASE_URL}/api/super/invoices", timeout=20)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        d = r.json()
        assert isinstance(d.get("invoices"), list)
        for k in ("count", "open", "paid", "overdue", "overdueCount"):
            assert k in d["totals"], f"totals.{k} missing"

    def test_issue_all_summary(self):
        s = _super()
        r = s.post(f"{BASE_URL}/api/super/invoices", json={"action": "issue-all", "month": CURRENT_MONTH}, timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        d = r.json()
        for k in ("issued", "existing", "skipped", "companies"):
            assert k in d, f"missing {k}"

    def test_remind_overdue_summary(self):
        s = _super()
        r = s.post(f"{BASE_URL}/api/super/invoices", json={"action": "remind-overdue"}, timeout=120)
        assert r.status_code == 200
        d = r.json()
        assert "reminded" in d and "attempted" in d

    def test_bad_action(self):
        s = _super()
        r = s.post(f"{BASE_URL}/api/super/invoices", json={"action": "nope"}, timeout=15)
        assert r.status_code == 400

    def test_action_on_unknown_invoice_404(self):
        s = _super()
        r = s.post(f"{BASE_URL}/api/super/invoices/id/does-not-exist", json={"action": "pay"}, timeout=15)
        assert r.status_code == 404
