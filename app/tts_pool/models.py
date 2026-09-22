from __future__ import annotations

import json
import os
from pathlib import Path
from urllib import error, parse, request

from fastapi import APIRouter, Body, HTTPException
from app.settings_files import load_object, merge_objects

router = APIRouter(prefix="/tts-pool/models", tags=["tts-pool"])

DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parents[2] / "config" / "settings.json"
DEFAULT_TTS_POOL_API_BASE_URL = "http://127.0.0.1:8020"


def _tts_pool_base_url() -> str:
    env_value = os.environ.get("TTS_POOL_API_BASE_URL", "").strip()
    if env_value:
        return env_value.rstrip("/")

    settings_path = DEFAULT_SETTINGS_PATH
    payload = merge_objects(
        load_object(settings_path),
        load_object(settings_path.with_name("local.json")),
    )
    tts_pool_payload = payload.get("tts_pool", {})
    if isinstance(tts_pool_payload, dict):
        base_url = str(tts_pool_payload.get("base_url", "")).strip()
        if base_url:
            return base_url.rstrip("/")

    return DEFAULT_TTS_POOL_API_BASE_URL.rstrip("/")


def _request_json(
    *,
    method: str,
    path: str,
    payload: dict | None = None,
    timeout: float = 2.0,
) -> dict:
    headers = {"Accept": "application/json"}
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode("utf-8")

    req = request.Request(
        url=f"{_tts_pool_base_url()}{path}",
        method=method,
        headers=headers,
        data=data,
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            if not raw:
                return {}
            return json.loads(raw)
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        if raw:
            try:
                detail = json.loads(raw)
            except json.JSONDecodeError:
                detail = {"error": raw}
        else:
            detail = {"error": f"HTTP {exc.code}"}
        raise HTTPException(status_code=exc.code, detail=detail) from exc
    except (error.URLError, TimeoutError) as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": "tts_pool_unreachable", "message": str(exc)},
        ) from exc


@router.get("")
def list_models() -> list[dict[str, str]]:
    """Get currently loaded models from tts-pool service."""
    try:
        data = _request_json(method="GET", path="/v1/models", timeout=2.0)
        models = data.get("models", [])
        return [{"id": m, "name": m} for m in models]
    except HTTPException:
        return []


@router.get("/admin")
def get_admin_models() -> dict:
    """Get runtime admin model state from tts-pool."""
    return _request_json(method="GET", path="/v1/admin/models", timeout=3.0)


@router.get("/admin/gpu-memory")
def get_admin_gpu_memory() -> dict:
    """Get GPU memory summary from tts-pool runtime admin API."""
    return _request_json(method="GET", path="/v1/admin/gpu-memory", timeout=3.0)


@router.post("/admin/{model_name}/load")
def load_admin_model(model_name: str, load_request: dict | None = Body(default=None)) -> dict:
    """Load model via tts-pool runtime admin API."""
    safe_model_name = parse.quote(model_name, safe="")
    return _request_json(
        method="POST",
        path=f"/v1/admin/models/{safe_model_name}/load",
        payload=load_request,
        timeout=30.0,
    )


@router.post("/admin/{model_name}/unload")
def unload_admin_model(model_name: str) -> dict:
    """Unload model via tts-pool runtime admin API."""
    safe_model_name = parse.quote(model_name, safe="")
    return _request_json(
        method="POST",
        path=f"/v1/admin/models/{safe_model_name}/unload",
        timeout=30.0,
    )
