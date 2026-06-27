from __future__ import annotations

import json
import os
from pathlib import Path
from urllib import error, parse, request

from fastapi import APIRouter, Body, HTTPException

router = APIRouter(prefix="/image-pool", tags=["image-pool"])

DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parents[2] / "config" / "settings.json"
DEFAULT_IMAGE_POOL_API_BASE_URL = "http://127.0.0.1:8013"


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


def _image_pool_base_url() -> str:
    env_value = os.environ.get("IMAGE_POOL_API_BASE_URL", "").strip()
    if env_value:
        return env_value.rstrip("/")

    settings_path = DEFAULT_SETTINGS_PATH
    payload = _merge_json_objects(
        _load_json_object(settings_path),
        _load_json_object(settings_path.with_name("local.json")),
    )
    image_pool_payload = payload.get("image_pool", {})
    if isinstance(image_pool_payload, dict):
        base_url = str(image_pool_payload.get("base_url", "")).strip()
        if base_url:
            return base_url.rstrip("/")

    return DEFAULT_IMAGE_POOL_API_BASE_URL.rstrip("/")


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
        url=f"{_image_pool_base_url()}{path}",
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
            detail={"error": "image_pool_unreachable", "message": str(exc)},
        ) from exc


@router.get("/models")
def list_models() -> list[dict[str, object]]:
    """Get currently loaded models from image-pool service."""
    try:
        data = _request_json(method="GET", path="/v1/models", timeout=2.0)
        return _normalize_public_models(data)
    except HTTPException:
        return []


@router.get("/models/admin")
def get_admin_models() -> dict:
    """Get runtime admin model state from image-pool."""
    payload = _request_json(method="GET", path="/v1/admin/models", timeout=3.0)
    return {
        "models": [_normalize_admin_model(model) for model in _extract_model_list(payload)],
        "proxy_base_url": _image_pool_base_url(),
    }


@router.get("/models/admin/gpu-memory")
def get_admin_gpu_memory() -> dict:
    """Get GPU memory summary from image-pool runtime admin API."""
    payload = _request_json(method="GET", path="/v1/admin/gpu-memory", timeout=3.0)
    return _normalize_gpu_memory_payload(payload)


@router.post("/models/admin/{model_name}/load")
def load_admin_model(model_name: str, load_request: dict | None = Body(default=None)) -> dict:
    """Load model via image-pool runtime admin API."""
    safe_model_name = parse.quote(model_name, safe="")
    payload = _request_json(
        method="POST",
        path=f"/v1/admin/models/{safe_model_name}/load",
        payload=load_request,
        timeout=30.0,
    )
    return _normalize_admin_model(payload)


@router.post("/models/admin/{model_name}/unload")
def unload_admin_model(model_name: str) -> dict:
    """Unload model via image-pool runtime admin API."""
    safe_model_name = parse.quote(model_name, safe="")
    payload = _request_json(
        method="POST",
        path=f"/v1/admin/models/{safe_model_name}/unload",
        timeout=30.0,
    )
    return _normalize_admin_model(payload)


@router.post("/images/generations")
def run_image_generation(payload: dict = Body(default_factory=dict)) -> dict:
    """Generate images via image-pool."""
    return _request_json(
        method="POST",
        path="/v1/images/generations",
        payload=payload,
        timeout=120.0,
    )


@router.post("/images/edits")
def run_image_edit(payload: dict = Body(default_factory=dict)) -> dict:
    """Edit images via image-pool."""
    return _request_json(
        method="POST",
        path="/v1/images/edits",
        payload=payload,
        timeout=120.0,
    )


def _normalize_public_models(payload: dict) -> list[dict[str, object]]:
    raw_models = payload.get("models")
    if isinstance(raw_models, list):
        return [
            {"id": str(model), "name": str(model), "backend": "", "capabilities": {}}
            for model in raw_models
            if str(model).strip()
        ]

    raw_data = payload.get("data")
    if isinstance(raw_data, list):
        models: list[dict[str, object]] = []
        for model in raw_data:
            if isinstance(model, dict):
                model_id = str(model.get("id", "")).strip()
                if model_id:
                    capabilities = model.get("capabilities", {})
                    models.append(
                        {
                            "id": model_id,
                            "name": model_id,
                            "backend": str(model.get("backend") or ""),
                            "capabilities": capabilities if isinstance(capabilities, dict) else {},
                            "recommended_steps": _none_or_non_negative_int(model.get("recommended_steps")),
                            "recommended_guidance": _none_or_non_negative_float(model.get("recommended_guidance")),
                        }
                    )
            elif str(model).strip():
                model_id = str(model)
                models.append({"id": model_id, "name": model_id, "backend": "", "capabilities": {}})
        return models

    return []


def _extract_model_list(payload: dict) -> list[dict]:
    raw_models = payload.get("models")
    if isinstance(raw_models, list):
        return [model for model in raw_models if isinstance(model, dict)]

    raw_data = payload.get("data")
    if isinstance(raw_data, list):
        return [model for model in raw_data if isinstance(model, dict)]

    if payload.get("id") or payload.get("name"):
        return [payload]

    return []


def _normalize_admin_model(model: dict) -> dict:
    name = str(model.get("name") or model.get("id") or "").strip()
    scheduler = model.get("scheduler", {})
    if not isinstance(scheduler, dict):
        scheduler = {}

    raw_runtime_state = str(model.get("runtime_state") or "").strip().lower()
    loaded = bool(model.get("loaded", model.get("is_loaded", raw_runtime_state == "loaded")))
    loading = bool(model.get("loading", raw_runtime_state == "loading"))
    last_error = model.get("last_error")
    if raw_runtime_state in {"loaded", "loading", "unloading", "unloaded", "failed", "error"}:
        runtime_state = raw_runtime_state
    elif last_error:
        runtime_state = "failed"
    elif loading:
        runtime_state = "loading"
    elif loaded:
        runtime_state = "loaded"
    else:
        runtime_state = "unloaded"

    capabilities = model.get("capabilities", {})
    if not isinstance(capabilities, dict):
        capabilities = {}

    backend = str(model.get("backend") or model.get("resolved_backend") or "").strip()
    target_inflight = _to_non_negative_int(
        scheduler.get("target_inflight", model.get("configured_target_inflight", 1))
    )

    return {
        "name": name,
        "resolved_backend": backend,
        "configured_enabled": bool(model.get("enabled", model.get("configured_enabled", False))),
        "runtime_state": runtime_state,
        "is_loaded": loaded,
        "inflight_requests": _to_non_negative_int(scheduler.get("inflight", model.get("inflight_requests", 0))),
        "queue_depth": _to_non_negative_int(scheduler.get("queued", model.get("queue_depth", 0))),
        "configured_target_inflight": target_inflight,
        "effective_target_inflight": target_inflight,
        "last_error": last_error,
        "vram_estimate_mib": _none_or_non_negative_int(model.get("vram_estimate_mib")),
        "vram_estimate_source": str(model.get("vram_estimate_source") or "configured"),
        "capabilities": capabilities,
        "definition": {
            "model_path": model.get("model_path"),
            "backend": backend,
            "enabled": bool(model.get("enabled", model.get("configured_enabled", False))),
            "target_inflight": target_inflight,
            "recommended_steps": _none_or_non_negative_int(model.get("recommended_steps")),
            "recommended_guidance": _none_or_non_negative_float(model.get("recommended_guidance")),
        },
    }


def _normalize_gpu_memory_payload(payload: dict) -> dict:
    gpus = []
    raw_gpus = payload.get("gpus", [])
    for gpu in raw_gpus if isinstance(raw_gpus, list) else []:
        if not isinstance(gpu, dict):
            continue
        total_mib = _to_non_negative_int(gpu.get("total_mib", gpu.get("memory_total_mib", 0)))
        used_mib = _to_non_negative_int(gpu.get("used_mib", gpu.get("memory_used_mib", 0)))
        gpus.append(
            {
                "index": _to_non_negative_int(gpu.get("index", 0)),
                "name": str(gpu.get("name", "")),
                "total_mib": total_mib,
                "used_mib": used_mib,
                "free_mib": _to_non_negative_int(gpu.get("free_mib", gpu.get("memory_free_mib", 0))),
                "used_over_total": f"{used_mib}MiB / {total_mib}MiB" if total_mib else "",
            }
        )

    models = []
    raw_models = payload.get("models", [])
    for model in raw_models if isinstance(raw_models, list) else []:
        if not isinstance(model, dict):
            continue
        name = str(model.get("name") or model.get("id") or "").strip()
        if not name:
            continue
        models.append(
            {
                "name": name,
                "vram_estimate_mib": _none_or_non_negative_int(model.get("vram_estimate_mib")),
                "vram_estimate_source": str(model.get("vram_estimate_source") or "configured"),
            }
        )

    normalized = dict(payload)
    normalized["gpus"] = gpus
    normalized["models"] = models
    return normalized


def _to_non_negative_int(value: object) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, parsed)


def _none_or_non_negative_int(value: object) -> int | None:
    if value is None:
        return None
    return _to_non_negative_int(value)


def _none_or_non_negative_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, parsed)
