from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException
from pathlib import Path
from urllib import error, parse, request
import json
import os

router = APIRouter(prefix="/models", tags=["models"])

DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parents[2] / "config" / "settings.json"
DEFAULT_LLM_RESPONSES_API_BASE_URL = "http://127.0.0.1:8011"


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


def _llm_pool_base_url() -> str:
    env_value = os.environ.get("LLM_RESPONSES_API_BASE_URL", "").strip()
    if env_value:
        return env_value.rstrip("/")

    settings_path = DEFAULT_SETTINGS_PATH
    payload = _merge_json_objects(
        _load_json_object(settings_path),
        _load_json_object(settings_path.with_name("local.json")),
    )
    llm_pool_payload = payload.get("llm_pool", {})
    if isinstance(llm_pool_payload, dict):
        base_url = str(llm_pool_payload.get("base_url", "")).strip()
        if base_url:
            return base_url.rstrip("/")

    return DEFAULT_LLM_RESPONSES_API_BASE_URL.rstrip("/")


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
        url=f"{_llm_pool_base_url()}{path}",
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
            detail={"error": "llm_pool_unreachable", "message": str(exc)},
        ) from exc


@router.get("")
def list_models() -> list[dict[str, str]]:
    """Get available models from llm-pool service."""
    try:
        data = _request_json(method="GET", path="/v1/models", timeout=2.0)
        models = data.get("models", [])
        return [{"id": m, "name": m} for m in models]
    except HTTPException:
        return []


@router.get("/admin")
def get_admin_models() -> dict:
    """Get runtime admin model state from llm-pool."""
    payload = _request_json(method="GET", path="/v1/admin/models", timeout=3.0)
    payload["proxy_base_url"] = _llm_pool_base_url()
    return payload


@router.get("/admin/gpu-memory")
def get_admin_gpu_memory() -> dict:
    """Get GPU memory summary from llm-pool runtime admin API."""
    return _request_json(method="GET", path="/v1/admin/gpu-memory", timeout=3.0)


@router.post("/admin/{model_name}/load")
def load_admin_model(model_name: str, load_request: dict | None = Body(default=None)) -> dict:
    """Load model via runtime admin API."""
    safe_model_name = parse.quote(model_name, safe="")
    return _request_json(
        method="POST",
        path=f"/v1/admin/models/{safe_model_name}/load",
        payload=load_request,
        timeout=30.0,
    )


@router.post("/admin/{model_name}/unload")
def unload_admin_model(model_name: str) -> dict:
    """Unload model via runtime admin API."""
    safe_model_name = parse.quote(model_name, safe="")
    return _request_json(
        method="POST",
        path=f"/v1/admin/models/{safe_model_name}/unload",
        timeout=30.0,
    )
