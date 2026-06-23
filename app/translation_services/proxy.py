from __future__ import annotations

import json
import os
from pathlib import Path
from urllib import error, parse, request
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response


router = APIRouter(prefix="/translation", tags=["translation"])

DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parents[2] / "config" / "settings.json"
DEFAULT_BASE_URL = "http://127.0.0.1:8030"


def _load_json_object(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    raw_text = path.read_text(encoding="utf-8")
    if raw_text.strip() == "":
        return {}
    payload = json.loads(raw_text)
    if not isinstance(payload, dict):
        return {}
    return dict(payload)


def _merge_json_objects(base: dict[str, object], override: dict[str, object]) -> dict[str, object]:
    merged: dict[str, object] = dict(base)
    for key, value in override.items():
        base_value = merged.get(key)
        if isinstance(base_value, dict) and isinstance(value, dict):
            merged[key] = _merge_json_objects(base_value, value)
        else:
            merged[key] = value
    return merged


def _base_url() -> str:
    env_value = os.environ.get("TRANSLATION_SERVICES_API_BASE_URL", "").strip()
    if env_value:
        return env_value.rstrip("/")

    settings_path = DEFAULT_SETTINGS_PATH
    payload = _merge_json_objects(
        _load_json_object(settings_path),
        _load_json_object(settings_path.with_name("local.json")),
    )
    service_payload = payload.get("translation_services", {})
    if isinstance(service_payload, dict):
        base_url = str(service_payload.get("base_url", "")).strip()
        if base_url:
            return base_url.rstrip("/")

    return DEFAULT_BASE_URL.rstrip("/")


def _request_json(*, method: str, path: str, payload: dict | None = None, timeout: float = 2.0) -> dict:
    headers = {"Accept": "application/json"}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")

    req = request.Request(url=f"{_base_url()}{path}", method=method, headers=headers, data=data)
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


@router.post("/requests")
async def submit_request(
    request_json: str = Form(...),
    image_file: UploadFile = File(...),
) -> dict:
    image_bytes = await image_file.read()
    return _request_multipart_json(
        path="/v1/requests",
        request_json=request_json,
        image_filename=str(image_file.filename or "image"),
        image_content_type=str(image_file.content_type or "application/octet-stream"),
        image_bytes=image_bytes,
        timeout=60.0,
    )


@router.get("/requests/{request_id}")
def get_request(request_id: str) -> dict:
    safe_request_id = parse.quote(request_id, safe="")
    return _request_json(method="GET", path=f"/v1/requests/{safe_request_id}", timeout=3.0)


@router.post("/requests/{request_id}/cancel")
def cancel_request(request_id: str) -> dict:
    safe_request_id = parse.quote(request_id, safe="")
    return _request_json(method="POST", path=f"/v1/requests/{safe_request_id}/cancel", timeout=10.0)


@router.post("/requests/{request_id}/retranslate")
def retranslate_request(request_id: str, body: dict | None = None) -> dict:
    safe_request_id = parse.quote(request_id, safe="")
    return _request_json(
        method="POST",
        path=f"/v1/requests/{safe_request_id}/retranslate",
        payload=dict(body or {}),
        timeout=60.0,
    )


@router.get("/requests/{request_id}/artifacts/{artifact_name}")
def get_artifact(request_id: str, artifact_name: str) -> Response:
    safe_request_id = parse.quote(request_id, safe="")
    safe_artifact_name = parse.quote(artifact_name, safe="")
    payload, media_type = _request_binary(
        path=f"/v1/requests/{safe_request_id}/artifacts/{safe_artifact_name}",
        timeout=10.0,
    )
    return Response(content=payload, media_type=media_type)


@router.get("/prompts")
def list_prompts() -> dict:
    return _request_json(method="GET", path="/v1/prompts", timeout=5.0)


@router.post("/prompts")
def create_prompt(body: dict | None = None) -> dict:
    return _request_json(method="POST", path="/v1/prompts", payload=dict(body or {}), timeout=5.0)


@router.get("/prompts/{prompt_id:path}")
def get_prompt(prompt_id: str) -> dict:
    safe_id = parse.quote(prompt_id, safe="/")
    return _request_json(method="GET", path=f"/v1/prompts/{safe_id}", timeout=5.0)


@router.put("/prompts/{prompt_id:path}")
def update_prompt(prompt_id: str, body: dict | None = None) -> dict:
    safe_id = parse.quote(prompt_id, safe="/")
    return _request_json(method="PUT", path=f"/v1/prompts/{safe_id}", payload=dict(body or {}), timeout=5.0)


@router.delete("/prompts/{prompt_id:path}")
def delete_prompt(prompt_id: str) -> dict:
    safe_id = parse.quote(prompt_id, safe="/")
    return _request_json(method="DELETE", path=f"/v1/prompts/{safe_id}", timeout=5.0)


@router.get("/completions")
def get_completions(since_seq: int = 0, limit: int = 100) -> dict:
    query = parse.urlencode({"since_seq": max(0, int(since_seq)), "limit": max(1, min(1000, int(limit)))})
    return _request_json(method="GET", path=f"/v1/completions?{query}", timeout=3.0)


@router.get("/status")
def get_status() -> dict:
    return _request_json(method="GET", path="/v1/status", timeout=3.0)


@router.get("/regression/status")
def regression_status(name: str = "") -> dict:
    query = parse.urlencode({"name": name})
    return _request_json(method="GET", path=f"/v1/regression/status?{query}", timeout=5.0)


@router.post("/regression/testset")
def regression_testset(body: dict | None = None) -> dict:
    return _request_json(method="POST", path="/v1/regression/testset", payload=dict(body or {}), timeout=15.0)


@router.post("/regression/fixtures")
def regression_fixtures(body: dict | None = None) -> dict:
    # The capture re-OCRs the rendered image server-side, so allow a generous timeout.
    return _request_json(method="POST", path="/v1/regression/fixtures", payload=dict(body or {}), timeout=90.0)


@router.get("/regression/fixtures")
def regression_fixtures_list() -> dict:
    return _request_json(method="GET", path="/v1/regression/fixtures", timeout=5.0)


@router.get("/regression/source/{name}")
def regression_source(name: str) -> Response:
    payload, media_type = _request_binary(path=f"/v1/regression/source/{parse.quote(name, safe='')}", timeout=10.0)
    return Response(content=payload, media_type=media_type)


@router.get("/regression/fixtures/{name}/{lang}/{variant}/{artifact}")
def regression_variant_artifact(name: str, lang: str, variant: str, artifact: str) -> Response:
    seg = lambda value: parse.quote(value, safe="")
    payload, media_type = _request_binary(
        path=f"/v1/regression/fixtures/{seg(name)}/{seg(lang)}/{seg(variant)}/{seg(artifact)}",
        timeout=10.0,
    )
    return Response(content=payload, media_type=media_type)


@router.post("/regression/run")
def regression_run(body: dict | None = None) -> dict:
    # Replays + re-OCRs one fixture server-side; generous timeout.
    return _request_json(method="POST", path="/v1/regression/run", payload=dict(body or {}), timeout=90.0)


@router.delete("/regression/fixtures/{name}")
def regression_delete_name(name: str) -> dict:
    return _request_json(method="DELETE", path=f"/v1/regression/fixtures/{parse.quote(name, safe='')}", timeout=10.0)


@router.delete("/regression/fixtures/{name}/{lang}")
def regression_delete_lang(name: str, lang: str) -> dict:
    seg = lambda value: parse.quote(value, safe="")
    return _request_json(method="DELETE", path=f"/v1/regression/fixtures/{seg(name)}/{seg(lang)}", timeout=10.0)


@router.delete("/regression/fixtures/{name}/{lang}/{variant}")
def regression_delete_variant(name: str, lang: str, variant: str) -> dict:
    seg = lambda value: parse.quote(value, safe="")
    return _request_json(method="DELETE", path=f"/v1/regression/fixtures/{seg(name)}/{seg(lang)}/{seg(variant)}", timeout=10.0)


def _request_multipart_json(
    *,
    path: str,
    request_json: str,
    image_filename: str,
    image_content_type: str,
    image_bytes: bytes,
    timeout: float,
) -> dict:
    boundary = f"ts-{uuid.uuid4().hex}"
    body = _multipart_body(
        boundary=boundary,
        request_json=request_json,
        image_filename=image_filename,
        image_content_type=image_content_type,
        image_bytes=image_bytes,
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


def _request_binary(*, path: str, timeout: float) -> tuple[bytes, str]:
    req = request.Request(url=f"{_base_url()}{path}", method="GET", headers={"Accept": "*/*"})
    try:
        with request.urlopen(req, timeout=timeout) as response:
            media_type = str(response.headers.get("content-type") or "application/octet-stream")
            return response.read(), media_type
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
