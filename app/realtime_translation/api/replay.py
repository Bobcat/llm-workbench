from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.llm_pool.api.models import _request_json as _llm_pool_request_json
from app.realtime_translation.sessions import DEFAULT_FIRST_PASS_PROMPT_ID
from app.realtime_translation.sessions import DEFAULT_SECOND_PASS_PROMPT_ID
from app.realtime_translation.sessions import REPLAY_POLICIES
from app.realtime_translation.sessions import SPEED_PRESETS
from app.realtime_translation.sessions import ReplaySession
from app.realtime_translation.sessions import _apply_first_pass_prompt
from app.realtime_translation.sessions import _apply_second_pass_prompt
from app.realtime_translation.sessions import _build_metrics_summary
from app.realtime_translation.sessions import _build_metrics_summary_lines
from app.realtime_translation.sessions import _cancel_live_request_task
from app.realtime_translation.sessions import _load_first_pass_prompt
from app.realtime_translation.sessions import _load_second_pass_prompt
from app.realtime_translation.sessions import _playback_loop
from app.realtime_translation.sessions import _send_source_update
from app.realtime_translation.sessions import _send_target_update
from app.realtime_translation.sessions import _sessions
from app.realtime_translation.sessions import _sync_target_state
from app.realtime_translation.settings import load_replay_settings

router = APIRouter(prefix="/replay", tags=["replay"])

REPO_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_DIR = REPO_ROOT / "data" / "realtime_translation" / "sample"


def _sample_file_items() -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    if not SAMPLE_DIR.exists():
        return items
    for path in sorted(SAMPLE_DIR.glob("*.pc")):
        items.append({
            "path": str(path.relative_to(REPO_ROOT).as_posix()),
            "name": path.name,
        })
    return items


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

    if backend == "gguf":
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
    settings = load_replay_settings()

    if len(session.models_used) > 1:
        lines.append("Model settings: unavailable (<mixed models>)")
    else:
        first_pass_model = (
            next(iter(session.models_used))
            if len(session.models_used) == 1
            else (session.model or settings.first_pass.default_model)
        )
        model_payload = admin_models.get(first_pass_model)
        if model_payload is not None:
            lines.extend(_build_runtime_model_settings_lines("Model", model_payload))
        elif first_pass_model:
            lines.append(f"Model settings: unavailable ({first_pass_model})")

    if len(session.correction_models_used) > 1:
        lines.append("Correction settings: unavailable (<mixed correction models>)")
    else:
        correction_model = (
            next(iter(session.correction_models_used))
            if len(session.correction_models_used) == 1
            else session.correction_model
        )
        if correction_model:
            model_payload = admin_models.get(correction_model)
            if model_payload is not None:
                lines.extend(_build_runtime_model_settings_lines("Correction", model_payload))
            else:
                lines.append(f"Correction settings: unavailable ({correction_model})")

    return lines


class CreateSessionRequest(BaseModel):
    file_path: str


class SpeedRequest(BaseModel):
    speed: str


class PolicyRequest(BaseModel):
    policy: str


class ModelRequest(BaseModel):
    model: str


class CorrectionModelRequest(BaseModel):
    model: str


class FirstPassPromptRequest(BaseModel):
    prompt_id: str


class FirstPassLanguagesRequest(BaseModel):
    source_language: str | None = None
    target_language: str | None = None


@router.get("/samples")
async def list_sample_files():
    return {"samples": _sample_file_items()}


@router.post("/session")
async def create_session(request: CreateSessionRequest):
    """Create a new replay session from .pc file."""
    session_id = str(uuid.uuid4())
    path = Path(request.file_path)

    if not path.is_absolute():
        path = REPO_ROOT / path

    if not path.exists():
        return {"error": "File not found", "path": str(path.absolute())}

    settings = load_replay_settings()
    try:
        default_first_pass_prompt = _load_first_pass_prompt(DEFAULT_FIRST_PASS_PROMPT_ID)
        default_second_pass_prompt = _load_second_pass_prompt(DEFAULT_SECOND_PASS_PROMPT_ID)
    except ValueError as exc:
        return {"error": str(exc)}

    session = ReplaySession.create(
        session_id=session_id,
        file_path=path,
        settings=settings,
        default_first_pass_prompt=default_first_pass_prompt,
        default_second_pass_prompt=default_second_pass_prompt,
    )
    _sessions[session_id] = session

    return {
        "session_id": session_id,
        "event_count": len(session.events),
        "first_pass_prompt_id": session.first_pass_prompt_id,
        "second_pass_prompt_id": session.second_pass_prompt_id,
        "policy": session.policy,
    }


@router.post("/{session_id}/speed")
async def set_speed(session_id: str, request: SpeedRequest):
    """Set playback speed. Works during playback."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    if request.speed not in SPEED_PRESETS:
        return {"error": f"Invalid speed: {request.speed}"}

    session.speed = request.speed

    return {
        "status": "ok",
        "speed": session.speed,
        "delay_ms": session.get_delay_ms(),
    }


@router.post("/{session_id}/policy")
async def set_policy(session_id: str, request: PolicyRequest):
    """Set replay policy. Only allowed while idle."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    policy = str(request.policy or "").strip().lower()
    if policy not in REPLAY_POLICIES:
        return {"error": f"Invalid policy: {request.policy}"}
    if session.status != "idle":
        return {"error": "Policy can only be changed while idle. Reset first."}

    if policy != session.policy:
        session.policy = policy
        session.init_runner()
        _sync_target_state(session)

    if session.websocket:
        try:
            await session.websocket.send_json({
                "type": "policy_update",
                "data": {"policy": session.policy},
            })
        except Exception:
            pass

    return {
        "status": "ok",
        "policy": session.policy,
    }


@router.post("/{session_id}/model")
async def set_model(session_id: str, request: ModelRequest):
    """Set model for translations. Empty string = no translator (passthrough)."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    new_model = request.model if request.model else None
    if new_model != session.model:
        session.model = new_model
        session.swap_translator()

    if session.websocket:
        try:
            await session.websocket.send_json({
                "type": "model_update",
                "data": {"model": session.get_model_display()},
            })
        except Exception:
            pass

    return {
        "status": "ok",
        "model": session.get_model_display(),
    }


@router.post("/{session_id}/correction-model")
async def set_correction_model(session_id: str, request: CorrectionModelRequest):
    """Set correction model. Empty string means correction is Off."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    new_correction_model = request.model.strip() if request.model else ""
    if new_correction_model != session.correction_model:
        session.correction_model = new_correction_model
        session.swap_translator()

    return {
        "status": "ok",
        "correction_model": session.correction_model,
        "correction_enabled": bool(session.correction_model),
    }


@router.post("/{session_id}/first-pass-prompt")
async def set_first_pass_prompt(session_id: str, request: FirstPassPromptRequest):
    """Set the first-pass prompt from prompt library."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    try:
        prompt = _load_first_pass_prompt(request.prompt_id)
    except ValueError as exc:
        return {"error": str(exc)}

    _apply_first_pass_prompt(session, prompt)
    session.swap_translator()

    return {
        "status": "ok",
        "prompt_id": prompt.id,
        "title": prompt.title,
    }


@router.post("/{session_id}/second-pass-prompt")
async def set_second_pass_prompt(session_id: str, request: FirstPassPromptRequest):
    """Set the second-pass prompt from prompt library."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    try:
        prompt = _load_second_pass_prompt(request.prompt_id)
    except ValueError as exc:
        return {"error": str(exc)}

    _apply_second_pass_prompt(session, prompt)
    session.swap_translator()

    return {
        "status": "ok",
        "prompt_id": prompt.id,
        "title": prompt.title,
    }


@router.post("/{session_id}/first-pass-languages")
async def set_first_pass_languages(session_id: str, request: FirstPassLanguagesRequest):
    """Set first-pass source/target languages. Works during playback."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    changed = False
    if request.source_language is not None:
        next_source_language = str(request.source_language).strip()
        if next_source_language == "":
            return {"error": "source_language must not be empty"}
        if next_source_language != session.source_language:
            session.source_language = next_source_language
            changed = True

    if request.target_language is not None:
        next_target_language = str(request.target_language).strip()
        if next_target_language == "":
            return {"error": "target_language must not be empty"}
        if next_target_language != session.target_language:
            session.target_language = next_target_language
            changed = True

    if changed:
        session.swap_translator()
        if session.websocket:
            try:
                await session.websocket.send_json({
                    "type": "first_pass_languages_update",
                    "data": {
                        "source_language": session.source_language,
                        "target_language": session.target_language,
                    },
                })
            except Exception:
                pass

    return {
        "status": "ok",
        "source_language": session.source_language,
        "target_language": session.target_language,
    }


@router.post("/{session_id}/start")
async def start_replay(session_id: str):
    """Start or resume playback."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    if session.status == "playing":
        return {"status": "already_playing"}

    if session.status == "completed":
        await _cancel_live_request_task(session)
        session.current_event_index = 1
        session.source_revision = 0
        session.target_revision = 0
        session.source_committed_text = ""
        session.source_preview_text = ""
        session.target_committed_text = ""
        session.target_preview_text = ""
        session.traces.clear()
        session.models_used.clear()
        session.correction_models_used.clear()
        if session.runner:
            session.runner.reset()
        _sync_target_state(session)

    session.status = "playing"
    asyncio.create_task(_playback_loop(session))
    return {"status": "started"}


@router.post("/{session_id}/pause")
async def pause_replay(session_id: str):
    """Pause playback."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    if session.status != "playing":
        return {"status": "not_playing"}

    session.status = "paused"
    if session.websocket:
        try:
            await session.websocket.send_json({
                "type": "state_update",
                "data": {
                    "status": "paused",
                    "event_index": session.current_event_index,
                },
            })
        except Exception:
            pass

    return {"status": "paused"}


@router.post("/{session_id}/reset")
async def reset_replay(session_id: str):
    """Reset playback to the beginning and stop (go to idle state)."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    if session.status == "playing" and session.current_task:
        session.current_task.cancel()
        try:
            await session.current_task
        except asyncio.CancelledError:
            pass
    await _cancel_live_request_task(session)

    session.status = "idle"
    session.current_event_index = 1
    session.source_revision = 0
    session.target_revision = 0
    session.source_committed_text = ""
    session.source_preview_text = ""
    session.target_committed_text = ""
    session.target_preview_text = ""
    session.traces.clear()
    session.models_used.clear()
    session.correction_models_used.clear()

    if session.runner:
        session.runner.reset()
    _sync_target_state(session)

    if session.websocket:
        try:
            await session.websocket.send_json({
                "type": "state_update",
                "data": {"status": "idle", "event_index": 1},
            })
            await _send_source_update(
                session,
                event_index=1,
                line_number=0,
                kind="reset",
                status="idle",
                force_reset=True,
            )
            await _send_target_update(
                session,
                event_index=1,
                triggered=False,
                reason="",
                wall_ms=0.0,
                force_reset=True,
            )
        except Exception:
            pass

    return {"status": "reset"}


async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket for real-time source updates."""
    await websocket.accept()

    session = _sessions.get(session_id)
    if not session:
        await websocket.close(code=4001, reason="Session not found")
        return

    session.websocket = websocket

    try:
        settings = load_replay_settings()
        preview = settings.preview_translation
        params_label = (
            f"sentence_gate=source; preview=min_chars={preview.min_chars}, "
            f"ratio<={preview.max_distance_ratio:.2f}, growth>={preview.min_growth_chars}"
        )

        await websocket.send_json({
            "type": "session_info",
            "data": {
                "total_events": len(session.events),
                "file_path": session.file_path,
                "params": params_label,
                "policy": session.policy,
                "first_pass_prompt_id": session.first_pass_prompt_id,
                "second_pass_prompt_id": session.second_pass_prompt_id,
                "source_language": session.source_language,
                "target_language": session.target_language,
                "source_revision": session.source_revision,
                "target_revision": session.target_revision,
                "correction_model": session.correction_model,
                "correction_enabled": bool(session.correction_model),
            },
        })

        current_event = (
            session.events[session.current_event_index - 1]
            if session.events and 1 <= session.current_event_index <= len(session.events)
            else None
        )
        await _send_source_update(
            session,
            event_index=session.current_event_index,
            line_number=current_event.line_number if current_event else 0,
            kind=current_event.kind if current_event else "",
            status=session.status,
            force_reset=True,
        )
        await _send_target_update(
            session,
            event_index=session.current_event_index,
            triggered=False,
            reason="",
            wall_ms=0.0,
            force_reset=True,
        )

        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        session.websocket = None
    except Exception:
        session.websocket = None


@router.get("/{session_id}/export")
async def export_final(session_id: str):
    """Export final snapshot with source, target, and metrics."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}

    if not session.events:
        return {"error": "No events in session"}

    def _visible_text(committed: str, preview: str) -> str:
        if not committed or not preview:
            return f"{committed}{preview}"
        if committed.endswith((" ", "\n")) or preview.startswith((" ", "\n")):
            return f"{committed}{preview}"
        return f"{committed} {preview}"

    source_text = _visible_text(session.source_committed_text, session.source_preview_text)
    target_text = _visible_text(session.target_committed_text, session.target_preview_text)
    metrics_summary = _build_metrics_summary(session=session, traces=session.traces)
    summary_lines = _build_metrics_summary_lines(metrics_summary)
    runtime_settings_lines = await _build_export_runtime_settings_lines(session)

    lines = [
        "Metrics",
        *summary_lines,
        *runtime_settings_lines,
        "",
        "Source",
        source_text if source_text else "(empty)",
        "",
        "Target",
        target_text if target_text else "(empty)",
        "",
    ]
    content = "\n".join(lines)

    from datetime import datetime, timezone
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stem = Path(session.file_path).stem
    first_pass_model = metrics_summary.get("model", "") or "default"
    correction_model = metrics_summary.get("correction_model", "")
    if len(session.models_used) > 1:
        model_slug = "mixed"
    elif correction_model and correction_model != first_pass_model:
        model_slug = f"{first_pass_model}_corr-{correction_model}"
    else:
        model_slug = str(first_pass_model)
    filename = f"{stem}_{model_slug}_{timestamp}.txt"

    return PlainTextResponse(
        content,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
