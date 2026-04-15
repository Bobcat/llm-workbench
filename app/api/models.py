from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException
from urllib import error, parse, request
import json
import os

router = APIRouter(prefix="/models", tags=["models"])

DEFAULT_LLM_RESPONSES_API_BASE_URL = os.environ.get(
    "LLM_RESPONSES_API_BASE_URL", "http://127.0.0.1:8011"
)


def _llm_pool_base_url() -> str:
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
    return _request_json(method="GET", path="/v1/admin/models", timeout=3.0)


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
