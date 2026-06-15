"""Phase 3h shim: phone verification is now mandatory before a booking is
dispatched. To keep the existing (pre-Phase-3) regression tests byte-for-byte
stable, this autouse fixture transparently obtains a verification token (via the
mock /api/verify flow) and injects it into every POST /api/bookings body that
doesn't already carry one.

Opt-out: include `"_noverify": True` in the JSON body. The sentinel is stripped
before the request is sent, and NO token is injected — used by the Phase-3
negative tests that assert the 403 "verification required" path.
"""
import os
import requests
import pytest

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://taxios-dispatch.preview.emergentagent.com"
).rstrip("/")

_token_cache: dict[str, str] = {}


def _get_token(orig_post, phone: str):
    if phone in _token_cache:
        return _token_cache[phone]
    try:
        rq = orig_post(f"{BASE_URL}/api/verify/request", json={"channel": "SMS", "target": phone}, timeout=15)
        code = rq.json().get("devCode")
    except Exception:
        code = None
    if not code:
        return None  # real provider (no devCode) -> leave unverified
    try:
        rc = orig_post(
            f"{BASE_URL}/api/verify/confirm",
            json={"channel": "SMS", "target": phone, "code": code},
            timeout=15,
        )
        tok = rc.json().get("token")
    except Exception:
        tok = None
    if tok:
        _token_cache[phone] = tok
    return tok


@pytest.fixture(autouse=True, scope="session")
def _auto_verify_bookings():
    orig_post = requests.post
    orig_sess_post = requests.sessions.Session.post

    def _inject(url, kwargs, poster):
        if isinstance(url, str) and url.rstrip("/").endswith("/api/bookings"):
            body = kwargs.get("json")
            if isinstance(body, dict):
                body = dict(body)
                skip = body.pop("_noverify", False)
                kwargs["json"] = body
                if not skip and body.get("customerPhone") and not body.get("verificationToken"):
                    tok = _get_token(poster, body["customerPhone"])
                    if tok:
                        body["verificationToken"] = tok
        return kwargs

    def patched_post(url, **kwargs):
        kwargs = _inject(url, kwargs, orig_post)
        return orig_post(url, **kwargs)

    def patched_sess_post(self, url, **kwargs):
        kwargs = _inject(url, kwargs, orig_post)
        return orig_sess_post(self, url, **kwargs)

    requests.post = patched_post
    requests.sessions.Session.post = patched_sess_post
    yield
    requests.post = orig_post
    requests.sessions.Session.post = orig_sess_post
