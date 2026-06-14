"""FastAPI proxy that forwards /api/* requests to the Next.js custom server on
port 3000. This adapter exists only so that the deployment platform routing
(/api -> 8001) reaches the Next.js API route handlers, where all real backend
logic lives. Everything else (pages, /socket.io, static assets) is served
directly by Next.js on port 3000.
"""

from __future__ import annotations

import os
from typing import Iterable

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

NEXT_ORIGIN = os.environ.get("NEXT_ORIGIN", "http://127.0.0.1:3000")

# Headers that must NOT be forwarded verbatim (hop-by-hop / managed by httpx).
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
    "content-encoding",
}


def _filter_headers(items: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    return [(k, v) for k, v in items if k.lower() not in _HOP_BY_HOP]


app = FastAPI(title="TaxiOS backend proxy")


@app.get("/")
async def root() -> dict:
    return {
        "service": "taxios-backend-proxy",
        "status": "ok",
        "upstream": NEXT_ORIGIN,
        "note": "All /api/* requests are forwarded to the Next.js server.",
    }


@app.get("/api/healthz")
async def health() -> dict:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{NEXT_ORIGIN}/api/healthz")
            ok = r.status_code == 200
    except Exception:
        ok = False
    return {"ok": True, "upstream_ok": ok}


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
)
async def api_proxy(path: str, request: Request) -> Response:
    url = f"{NEXT_ORIGIN}/api/{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    fwd_headers = _filter_headers(request.headers.items())
    # X-Forwarded-For sicherstellen, damit das Rate-Limiting im Next-Backend
    # greift (sonst sieht Next nur die Loopback-Verbindung des Proxys).
    if not request.headers.get("x-forwarded-for") and request.client:
        fwd_headers.append(("x-forwarded-for", request.client.host))
    body = await request.body()

    client = httpx.AsyncClient(timeout=60.0)
    try:
        upstream = await client.request(
            request.method,
            url,
            headers=fwd_headers,
            content=body if body else None,
            follow_redirects=False,
        )
    except httpx.RequestError as exc:
        await client.aclose()
        return JSONResponse(
            {"error": "upstream_unreachable", "detail": str(exc)},
            status_code=502,
        )

    out_headers = _filter_headers(upstream.headers.items())

    async def body_iter():
        try:
            # aiter_bytes() yields decoded bytes (matching the headers we send back).
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=dict(out_headers),
        media_type=upstream.headers.get("content-type"),
    )
