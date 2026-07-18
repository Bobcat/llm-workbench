"""Proxy for the translation-services PDF-benchmark endpoints.

Same upstream as the translation/pdf proxies (base URL shared from proxy.py).
The run endpoint forwards the browser's multipart as-is: ``request_json`` plus
optional ``translated_file``/``source_file``. Measurement upstream takes tens
of seconds to minutes (render + layout + OCR on both documents), hence the
long timeout.
"""

from __future__ import annotations

import json
import uuid
from urllib import error, request

from urllib import parse

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app.translation_services.proxy import (
    _base_url,
    _http_exception_from_error,
    _request_binary,
    _request_json,
)

router = APIRouter(prefix="/pdf-benchmark", tags=["pdf-benchmark"])


@router.get("/results")
def results() -> dict:
    return _request_json(method="GET", path="/v1/benchmark/results", timeout=15.0)


@router.get("/testset")
def testset() -> dict:
    return _request_json(method="GET", path="/v1/benchmark/testset", timeout=5.0)


@router.get("/runs/{doc_id}/{system}")
def run_detail(doc_id: str, system: str) -> dict:
    seg = lambda value: parse.quote(value, safe="")
    return _request_json(method="GET", path=f"/v1/benchmark/runs/{seg(doc_id)}/{seg(system)}", timeout=15.0)


@router.get("/runs/{doc_id}/{system}/{run_id}/anchors")
def run_anchors(doc_id: str, system: str, run_id: str) -> dict:
    seg = lambda value: parse.quote(value, safe="")
    return _request_json(
        method="GET",
        path=f"/v1/benchmark/runs/{seg(doc_id)}/{seg(system)}/{seg(run_id)}/anchors",
        timeout=30.0,
    )


@router.get("/runs/{doc_id}/{system}/{run_id}/overlay/{side}/{page}")
def run_overlay(doc_id: str, system: str, run_id: str, side: str, page: int) -> Response:
    seg = lambda value: parse.quote(value, safe="")
    payload, media_type = _request_binary(
        path=f"/v1/benchmark/runs/{seg(doc_id)}/{seg(system)}/{seg(run_id)}/overlay/{seg(side)}/{int(page)}",
        timeout=60.0,
    )
    return Response(content=payload, media_type=media_type)


@router.post("/run")
async def run(
    request_json: str = Form(...),
    translated_file: UploadFile | None = File(default=None),
    source_file: UploadFile | None = File(default=None),
) -> dict:
    parts: list[tuple[str, str | None, str | None, bytes]] = [
        ("request_json", None, "application/json; charset=utf-8", str(request_json or "{}").encode("utf-8")),
    ]
    for name, upload in (("translated_file", translated_file), ("source_file", source_file)):
        if upload is None:
            continue
        parts.append(
            (
                name,
                str(upload.filename or f"{name}.pdf"),
                str(upload.content_type or "application/pdf"),
                await upload.read(),
            )
        )
    boundary = f"ts-{uuid.uuid4().hex}"
    body = _multipart(boundary, parts)
    req = request.Request(
        url=f"{_base_url()}/v1/benchmark/run",
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        data=body,
    )
    try:
        with request.urlopen(req, timeout=600.0) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        raise _http_exception_from_error(exc) from exc
    except (error.URLError, TimeoutError) as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "translation_services_unreachable", "message": str(exc)},
        ) from exc


def _multipart(boundary: str, parts: list[tuple[str, str | None, str | None, bytes]]) -> bytes:
    chunks: list[bytes] = []
    for name, filename, content_type, payload in parts:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        if filename is None:
            chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n'.encode("utf-8"))
        else:
            safe = filename.replace("\\", "_").replace('"', "_")
            chunks.append(
                f'Content-Disposition: form-data; name="{name}"; filename="{safe}"\r\n'.encode("utf-8")
            )
        if content_type:
            safe_type = content_type.replace("\r", "").replace("\n", "")
            chunks.append(f"Content-Type: {safe_type}\r\n".encode("utf-8"))
        chunks.append(b"\r\n")
        chunks.append(payload)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks)
