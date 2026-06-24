from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from app.llm_pool.models import _request_json as _llm_pool_request_json

if TYPE_CHECKING:
    from app.realtime_translation.replay.sessions import ReplaySession


def _effective_admin_model_value(model_payload: dict[str, object], key: str):
    load_override = model_payload.get("load_override")
    if isinstance(load_override, dict) and key in load_override:
        return load_override[key]
    definition = model_payload.get("definition")
    if isinstance(definition, dict) and key in definition:
        return definition[key]
    load_constraints = model_payload.get("load_constraints")
    if isinstance(load_constraints, dict):
        constraint = load_constraints.get(key)
        if isinstance(constraint, dict) and "default" in constraint:
            return constraint["default"]
    return None


def _format_gguf_flash_attn(value: object) -> str:
    if isinstance(value, bool):
        return "on" if value else "off"
    if value is None:
        return "auto"
    text = str(value).strip()
    return text or "auto"


def _resolve_exllama_kv_bits(model_payload: dict[str, object]) -> tuple[str, str]:
    k_bits = _effective_admin_model_value(model_payload, "exllama_cache_k_bits")
    v_bits = _effective_admin_model_value(model_payload, "exllama_cache_v_bits")
    if k_bits is not None or v_bits is not None:
        return (
            "fp16" if k_bits in (None, "") else str(k_bits),
            "fp16" if v_bits in (None, "") else str(v_bits),
        )

    cache_quant = _effective_admin_model_value(model_payload, "exllama_cache_quant")
    if cache_quant in (None, ""):
        return "fp16", "fp16"

    parts = [part.strip() for part in str(cache_quant).split(",") if part.strip()]
    if len(parts) == 1:
        return parts[0], parts[0]
    if len(parts) >= 2:
        return parts[0], parts[1]
    return "fp16", "fp16"


def _build_runtime_model_settings_lines(prefix: str, model_payload: dict[str, object]) -> list[str]:
    backend = str(model_payload.get("resolved_backend") or "").strip().lower()
    if backend == "":
        return [f"{prefix} settings: unavailable"]

    lines = [f"{prefix} backend: {backend}"]

    if backend == "llama_cpp":
        lines.extend([
            f"{prefix} context size: {_effective_admin_model_value(model_payload, 'gguf_n_ctx')}",
            f"{prefix} flash attn: {_format_gguf_flash_attn(_effective_admin_model_value(model_payload, 'gguf_flash_attn'))}",
            f"{prefix} K type: {_effective_admin_model_value(model_payload, 'gguf_type_k')}",
            f"{prefix} V type: {_effective_admin_model_value(model_payload, 'gguf_type_v')}",
        ])
        return lines

    if backend == "exllamav3":
        k_bits, v_bits = _resolve_exllama_kv_bits(model_payload)
        lines.extend([
            f"{prefix} cache size: {_effective_admin_model_value(model_payload, 'exllama_cache_size')}",
            f"{prefix} K bits: {k_bits}",
            f"{prefix} V bits: {v_bits}",
        ])
        return lines

    return lines


async def _build_export_runtime_settings_lines(session: ReplaySession) -> list[str]:
    try:
        payload = await asyncio.to_thread(
            _llm_pool_request_json,
            method="GET",
            path="/v1/admin/models",
            timeout=3.0,
        )
    except Exception:
        return []

    models = payload.get("models")
    if not isinstance(models, list):
        return []

    admin_models: dict[str, dict[str, object]] = {}
    for item in models:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if name == "":
            continue
        admin_models[name] = item

    lines: list[str] = []

    if len(session.models_used) > 1:
        lines.append("Model settings: unavailable (<mixed models>)")
    else:
        first_pass_model = (
            next(iter(session.models_used))
            if len(session.models_used) == 1
            else (session.model or session.settings.first_pass.default_model)
        )
        model_payload = admin_models.get(first_pass_model)
        if model_payload is not None:
            lines.extend(_build_runtime_model_settings_lines("Model", model_payload))
        elif first_pass_model:
            lines.append(f"Model settings: unavailable ({first_pass_model})")

    if len(session.second_pass_models_used) > 1:
        lines.append("Second-pass settings: unavailable (<mixed second-pass models>)")
    else:
        second_pass_model = (
            next(iter(session.second_pass_models_used))
            if len(session.second_pass_models_used) == 1
            else session.second_pass_model
        )
        if second_pass_model:
            model_payload = admin_models.get(second_pass_model)
            if model_payload is not None:
                lines.extend(_build_runtime_model_settings_lines("Second-pass", model_payload))
            else:
                lines.append(f"Second-pass settings: unavailable ({second_pass_model})")

    return lines
