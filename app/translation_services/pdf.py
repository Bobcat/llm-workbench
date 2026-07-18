"""Proxy for the translation-services PDF-translation workflow.

Forwards to the same translation-services backend as the image proxy (see
`proxy.py`), so the low-level transport (base-URL resolution, JSON/binary
requests, upstream-error mapping) is shared from there. Only the multipart
submit differs: a PDF is uploaded under the `document_file` field with a
`translate_pdf` task, where the image proxy sends `image_file`.

The upstream `translate_pdf` handler is not built yet; until it lands these
routes surface the backend's 4xx/503 to the view unchanged.
"""

from __future__ import annotations

import json
import uuid
from urllib import error, parse, request

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app.translation_services.proxy import (
    _base_url,
    _http_exception_from_error,
    _request_binary,
    _request_json,
)

router = APIRouter(prefix="/pdf-translation", tags=["pdf-translation"])


@router.post("/requests")
async def submit_request(
    request_json: str = Form(...),
    document_file: UploadFile = File(...),
) -> dict:
    document_bytes = await document_file.read()
    return _submit_document_multipart(
        path="/v1/requests",
        request_json=request_json,
        filename=str(document_file.filename or "document.pdf"),
        content_type=str(document_file.content_type or "application/pdf"),
        document_bytes=document_bytes,
        timeout=120.0,
    )


@router.get("/requests/{request_id}")
def get_request(request_id: str) -> dict:
    safe_request_id = parse.quote(request_id, safe="")
    return _request_json(method="GET", path=f"/v1/requests/{safe_request_id}", timeout=5.0)


@router.post("/requests/{request_id}/cancel")
def cancel_request(request_id: str) -> dict:
    safe_request_id = parse.quote(request_id, safe="")
    return _request_json(method="POST", path=f"/v1/requests/{safe_request_id}/cancel", timeout=10.0)


@router.get("/requests/{request_id}/artifacts/{artifact_name}")
def get_artifact(request_id: str, artifact_name: str) -> Response:
    safe_request_id = parse.quote(request_id, safe="")
    safe_artifact_name = parse.quote(artifact_name, safe="")
    payload, media_type = _request_binary(
        path=f"/v1/requests/{safe_request_id}/artifacts/{safe_artifact_name}",
        timeout=30.0,
    )
    return Response(content=payload, media_type=media_type)


def _submit_document_multipart(
    *,
    path: str,
    request_json: str,
    filename: str,
    content_type: str,
    document_bytes: bytes,
    timeout: float,
) -> dict:
    boundary = f"ts-{uuid.uuid4().hex}"
    body = _multipart_body(
        boundary=boundary,
        request_json=request_json,
        filename=filename,
        content_type=content_type,
        document_bytes=document_bytes,
    )
    req = request.Request(
        url=f"{_base_url()}{path}",
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        data=body,
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except error.HTTPError as exc:
        raise _http_exception_from_error(exc) from exc
    except (error.URLError, TimeoutError) as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "translation_services_unreachable", "message": str(exc)},
        ) from exc


def _multipart_body(
    *,
    boundary: str,
    request_json: str,
    filename: str,
    content_type: str,
    document_bytes: bytes,
) -> bytes:
    safe_filename = str(filename or "document.pdf").replace("\\", "_").replace('"', "_")
    safe_content_type = str(content_type or "application/pdf").replace("\r", "").replace("\n", "")
    chunks = [
        f"--{boundary}\r\n".encode("utf-8"),
        b'Content-Disposition: form-data; name="request_json"\r\n',
        b"Content-Type: application/json; charset=utf-8\r\n\r\n",
        str(request_json or "{}").encode("utf-8"),
        b"\r\n",
        f"--{boundary}\r\n".encode("utf-8"),
        f'Content-Disposition: form-data; name="document_file"; filename="{safe_filename}"\r\n'.encode("utf-8"),
        f"Content-Type: {safe_content_type}\r\n\r\n".encode("utf-8"),
        bytes(document_bytes),
        b"\r\n",
        f"--{boundary}--\r\n".encode("utf-8"),
    ]
    return b"".join(chunks)
