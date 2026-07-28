"""Proxy for the translation-services PDF Anatomy endpoints."""

from __future__ import annotations

from urllib import parse

from fastapi import APIRouter
from fastapi.responses import Response

from app.translation_services.proxy import _request_binary
from app.translation_services.proxy import _request_json


router = APIRouter(prefix="/pdf-anatomy", tags=["pdf-anatomy"])

_seg = lambda value: parse.quote(str(value), safe="")


@router.get("/fixtures")
def fixtures() -> dict:
    return _request_json(
        method="GET",
        path="/v1/pdf-anatomy/fixtures",
        timeout=15.0,
    )


@router.post("/analyses")
def analyze(body: dict | None = None) -> dict:
    return _request_json(
        method="POST",
        path="/v1/pdf-anatomy/analyses",
        payload=dict(body or {}),
        timeout=120.0,
    )


@router.get("/analyses/{analysis_id}")
def summary(analysis_id: str) -> dict:
    return _request_json(
        method="GET",
        path=f"/v1/pdf-anatomy/analyses/{_seg(analysis_id)}",
        timeout=15.0,
    )


@router.get("/analyses/{analysis_id}/pages/{page}")
def page(analysis_id: str, page: int) -> dict:
    return _request_json(
        method="GET",
        path=f"/v1/pdf-anatomy/analyses/{_seg(analysis_id)}/pages/{int(page)}",
        timeout=30.0,
    )


@router.get("/analyses/{analysis_id}/pages/{page}/preview/{side}")
def preview(analysis_id: str, page: int, side: str) -> Response:
    payload, media_type = _request_binary(
        path=(
            f"/v1/pdf-anatomy/analyses/{_seg(analysis_id)}"
            f"/pages/{int(page)}/preview/{_seg(side)}"
        ),
        timeout=60.0,
    )
    return Response(content=payload, media_type=media_type)
