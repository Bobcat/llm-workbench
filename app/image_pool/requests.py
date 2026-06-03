from __future__ import annotations

import json
from urllib import error, parse, request
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app.image_pool.models import _image_pool_base_url
from app.image_pool.models import _request_json


router = APIRouter(prefix="/image-pool", tags=["image-pool"])


@router.post("/requests")
async def submit_image_request(
    request_json: str = Form(...),
    image_file: UploadFile = File(...),
) -> dict:
    image_bytes = await image_file.read()
    return _request_multipart_json(
        path="/v1/image/requests",
        request_json=request_json,
        image_filename=str(image_file.filename or "image"),
        image_content_type=str(image_file.content_type or "application/octet-stream"),
        image_bytes=image_bytes,
        timeout=60.0,
    )


@router.get("/requests/{request_id}")
def get_image_request(request_id: str) -> dict:
    safe_request_id = parse.quote(request_id, safe="")
    return _request_json(method="GET", path=f"/v1/image/requests/{safe_request_id}", timeout=3.0)


@router.post("/requests/{request_id}/cancel")
def cancel_image_request(request_id: str) -> dict:
    safe_request_id = parse.quote(request_id, safe="")
    return _request_json(method="POST", path=f"/v1/image/requests/{safe_request_id}/cancel", timeout=10.0)


@router.get("/requests/{request_id}/artifacts/{artifact_name}")
def get_image_artifact(request_id: str, artifact_name: str) -> Response:
    safe_request_id = parse.quote(request_id, safe="")
    safe_artifact_name = parse.quote(artifact_name, safe="")
    payload, media_type = _request_binary(
        path=f"/v1/image/requests/{safe_request_id}/artifacts/{safe_artifact_name}",
        timeout=10.0,
    )
    return Response(content=payload, media_type=media_type)


@router.get("/completions")
def get_image_completions(since_seq: int = 0, limit: int = 100) -> dict:
    query = parse.urlencode({"since_seq": max(0, int(since_seq)), "limit": max(1, min(1000, int(limit)))})
    return _request_json(method="GET", path=f"/v1/image/completions?{query}", timeout=3.0)


@router.get("/pool")
def get_image_pool_status() -> dict:
    return _request_json(method="GET", path="/v1/image/pool", timeout=3.0)


def _request_multipart_json(
    *,
    path: str,
    request_json: str,
    image_filename: str,
    image_content_type: str,
    image_bytes: bytes,
    timeout: float,
) -> dict:
    boundary = f"image-pool-{uuid.uuid4().hex}"
    body = _multipart_body(
        boundary=boundary,
        request_json=request_json,
        image_filename=image_filename,
        image_content_type=image_content_type,
        image_bytes=image_bytes,
    )
    req = request.Request(
        url=f"{_image_pool_base_url()}{path}",
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
            if not raw:
                return {}
            return json.loads(raw)
    except error.HTTPError as exc:
        raise _http_exception_from_error(exc) from exc
    except (error.URLError, TimeoutError) as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "image_pool_unreachable", "message": str(exc)},
        ) from exc


def _request_binary(*, path: str, timeout: float) -> tuple[bytes, str]:
    req = request.Request(
        url=f"{_image_pool_base_url()}{path}",
        method="GET",
        headers={"Accept": "*/*"},
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            media_type = str(response.headers.get("content-type") or "application/octet-stream")
            return response.read(), media_type
    except error.HTTPError as exc:
        raise _http_exception_from_error(exc) from exc
    except (error.URLError, TimeoutError) as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "image_pool_unreachable", "message": str(exc)},
        ) from exc


def _multipart_body(
    *,
    boundary: str,
    request_json: str,
    image_filename: str,
    image_content_type: str,
    image_bytes: bytes,
) -> bytes:
    safe_filename = str(image_filename or "image").replace("\\", "_").replace('"', "_")
    safe_content_type = str(image_content_type or "application/octet-stream").replace("\r", "").replace("\n", "")
    chunks = [
        f"--{boundary}\r\n".encode("utf-8"),
        b'Content-Disposition: form-data; name="request_json"\r\n',
        b"Content-Type: application/json; charset=utf-8\r\n\r\n",
        str(request_json or "{}").encode("utf-8"),
        b"\r\n",
        f"--{boundary}\r\n".encode("utf-8"),
        f'Content-Disposition: form-data; name="image_file"; filename="{safe_filename}"\r\n'.encode("utf-8"),
        f"Content-Type: {safe_content_type}\r\n\r\n".encode("utf-8"),
        bytes(image_bytes),
        b"\r\n",
        f"--{boundary}--\r\n".encode("utf-8"),
    ]
    return b"".join(chunks)


def _http_exception_from_error(exc: error.HTTPError) -> HTTPException:
    raw = exc.read().decode("utf-8", errors="replace")
    if raw:
        try:
            detail = json.loads(raw)
        except json.JSONDecodeError:
            detail = {"error": raw}
    else:
        detail = {"error": f"HTTP {exc.code}"}
    return HTTPException(status_code=exc.code, detail=detail)

