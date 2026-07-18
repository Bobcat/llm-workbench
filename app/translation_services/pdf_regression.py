"""Proxy for the translation-services PDF document-regression endpoints.

Same upstream as the translation/pdf/benchmark proxies (base URL shared from
proxy.py). Capture, replay and accept are GPU-bound upstream (per-page render +
re-OCR; with scoring also layout+OCR over both assembled documents), so those
three carry long timeouts like the benchmark run endpoint.
"""

from __future__ import annotations

from urllib import parse

from fastapi import APIRouter
from fastapi.responses import Response

from app.translation_services.proxy import _request_binary, _request_json

router = APIRouter(prefix="/pdf-regression", tags=["pdf-regression"])

_seg = lambda value: parse.quote(str(value), safe="")


@router.get("/fixtures")
def fixtures() -> dict:
    return _request_json(method="GET", path="/v1/pdf-regression/fixtures", timeout=15.0)


@router.get("/status")
def status(request_id: str) -> dict:
    return _request_json(
        method="GET", path=f"/v1/pdf-regression/status?request_id={_seg(request_id)}", timeout=15.0
    )


@router.post("/capture")
def capture(body: dict | None = None) -> dict:
    return _request_json(
        method="POST", path="/v1/pdf-regression/capture", payload=dict(body or {}), timeout=900.0
    )


@router.post("/run")
def run(body: dict | None = None) -> dict:
    return _request_json(
        method="POST", path="/v1/pdf-regression/run", payload=dict(body or {}), timeout=900.0
    )


@router.post("/accept")
def accept(body: dict | None = None) -> dict:
    return _request_json(
        method="POST", path="/v1/pdf-regression/accept", payload=dict(body or {}), timeout=900.0
    )


@router.delete("/fixtures/{name}/{lang}/{variant}")
def delete_fixture(name: str, lang: str, variant: str) -> dict:
    return _request_json(
        method="DELETE",
        path=f"/v1/pdf-regression/fixtures/{_seg(name)}/{_seg(lang)}/{_seg(variant)}",
        timeout=10.0,
    )


@router.get("/fixtures/{name}/{lang}/{variant}/artifact/{artifact}")
def document_artifact(name: str, lang: str, variant: str, artifact: str) -> Response:
    payload, media_type = _request_binary(
        path=f"/v1/pdf-regression/fixtures/{_seg(name)}/{_seg(lang)}/{_seg(variant)}/artifact/{_seg(artifact)}",
        timeout=30.0,
    )
    return Response(content=payload, media_type=media_type)


@router.get("/fixtures/{name}/{lang}/{variant}/pages/{page}/{artifact}")
def page_artifact(name: str, lang: str, variant: str, page: int, artifact: str) -> Response:
    payload, media_type = _request_binary(
        path=f"/v1/pdf-regression/fixtures/{_seg(name)}/{_seg(lang)}/{_seg(variant)}/pages/{int(page)}/{_seg(artifact)}",
        timeout=30.0,
    )
    return Response(content=payload, media_type=media_type)
