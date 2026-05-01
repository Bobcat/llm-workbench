from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.realtime_translation.replay.export_runtime import _build_export_runtime_settings_lines
from app.realtime_translation.replay.metrics import _build_metrics_summary
from app.realtime_translation.replay.metrics import _build_metrics_summary_lines
from app.realtime_translation.replay.prompt_selection import _apply_first_pass_prompt
from app.realtime_translation.replay.prompt_selection import _apply_second_pass_prompt
from app.realtime_translation.replay.prompt_selection import _load_first_pass_prompt
from app.realtime_translation.replay.prompt_selection import _load_second_pass_prompt
from app.realtime_translation.replay.transport import _send_source_update
from app.realtime_translation.replay.transport import _send_target_update
from app.realtime_translation.replay.sessions import DEFAULT_FIRST_PASS_PROMPT_ID
from app.realtime_translation.replay.sessions import DEFAULT_SECOND_PASS_PROMPT_ID
from app.realtime_translation.replay.sessions import REPLAY_POLICIES
from app.realtime_translation.replay.sessions import SPEED_PRESETS
from app.realtime_translation.replay.sessions import ReplaySession
from app.realtime_translation.replay.sessions import _cancel_live_request_task
from app.realtime_translation.replay.sessions import _playback_loop
from app.realtime_translation.replay.sessions import _sessions
from app.realtime_translation.replay.sessions import _sync_target_state
from app.realtime_translation.replay.settings import load_replay_settings
from app.realtime_translation.replay.tts import clear_replay_tts_artifacts
from app.realtime_translation.replay.tts import build_replay_tts_combined_artifact
from app.realtime_translation.replay.tts import replay_tts_combined_artifact_path
from app.realtime_translation.replay.tts import replay_tts_artifact_path
from promptlib import PromptRecord

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


class CreateSessionRequest(BaseModel):
    file_path: str


class SpeedRequest(BaseModel):
    speed: str


class PolicyRequest(BaseModel):
    policy: str


class ModelRequest(BaseModel):
    model: str


class SecondPassModelRequest(BaseModel):
    model: str


class FirstPassPromptRequest(BaseModel):
    prompt_id: str


class FirstPassLanguagesRequest(BaseModel):
    source_language: str | None = None
    target_language: str | None = None


class TtsRequest(BaseModel):
    enabled: bool


def _reset_session_state(session: ReplaySession) -> None:
    session.current_event_index = 1
    session.source_revision = 0
    session.target_revision = 0
    session.source_committed_text = ""
    session.source_preview_text = ""
    session.target_committed_text = ""
    session.target_preview_text = ""
    session.traces.clear()
    session.tts_artifacts.clear()
    clear_replay_tts_artifacts(session.session_id)
    session.models_used.clear()
    session.second_pass_models_used.clear()
    if session.runner:
        session.runner.reset()
    _sync_target_state(session)


async def _safe_send_session_message(
    session: ReplaySession,
    message_type: str,
    data: dict[str, object],
) -> None:
    if not session.websocket:
        return
    try:
        await session.websocket.send_json({"type": message_type, "data": data})
    except Exception:
        pass


def _set_session_prompt(
    session: ReplaySession,
    *,
    prompt_id: str,
    load_prompt: Callable[[str], PromptRecord],
    apply_prompt: Callable[[ReplaySession, PromptRecord], None],
) -> dict[str, str]:
    try:
        prompt = load_prompt(prompt_id)
    except ValueError as exc:
        return {"error": str(exc)}

    apply_prompt(session, prompt)
    session.swap_translator()
    return {
        "status": "ok",
        "prompt_id": prompt.id,
        "title": prompt.title,
    }


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
        "tts_enabled": session.tts_enabled,
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
    if not (session := _sessions.get(session_id)):
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

    await _safe_send_session_message(
        session,
        "policy_update",
        {"policy": session.policy},
    )

    return {
        "status": "ok",
        "policy": session.policy,
    }


@router.post("/{session_id}/model")
async def set_model(session_id: str, request: ModelRequest):
    """Set model for translations. Empty string = no translator (passthrough)."""
    if not (session := _sessions.get(session_id)):
        return {"error": "Session not found"}

    new_model = request.model if request.model else None
    if new_model != session.model:
        session.model = new_model
        session.swap_translator()

    await _safe_send_session_message(
        session,
        "model_update",
        {"model": session.get_model_display()},
    )

    return {
        "status": "ok",
        "model": session.get_model_display(),
    }


@router.post("/{session_id}/second-pass-model")
async def set_second_pass_model(session_id: str, request: SecondPassModelRequest):
    """Set second-pass model. Empty string means second pass is off."""
    if not (session := _sessions.get(session_id)):
        return {"error": "Session not found"}

    new_second_pass_model = request.model.strip() if request.model else ""
    if new_second_pass_model != session.second_pass_model:
        session.second_pass_model = new_second_pass_model
        session.swap_translator()

    return {
        "status": "ok",
        "second_pass_model": session.second_pass_model,
        "second_pass_enabled": bool(session.second_pass_model),
    }


@router.post("/{session_id}/first-pass-prompt")
async def set_first_pass_prompt(session_id: str, request: FirstPassPromptRequest):
    """Set the first-pass prompt from prompt library."""
    if not (session := _sessions.get(session_id)):
        return {"error": "Session not found"}
    return _set_session_prompt(
        session,
        prompt_id=request.prompt_id,
        load_prompt=_load_first_pass_prompt,
        apply_prompt=_apply_first_pass_prompt,
    )


@router.post("/{session_id}/second-pass-prompt")
async def set_second_pass_prompt(session_id: str, request: FirstPassPromptRequest):
    """Set the second-pass prompt from prompt library."""
    if not (session := _sessions.get(session_id)):
        return {"error": "Session not found"}
    return _set_session_prompt(
        session,
        prompt_id=request.prompt_id,
        load_prompt=_load_second_pass_prompt,
        apply_prompt=_apply_second_pass_prompt,
    )


@router.post("/{session_id}/first-pass-languages")
async def set_first_pass_languages(session_id: str, request: FirstPassLanguagesRequest):
    """Set first-pass source/target languages. Works during playback."""
    if not (session := _sessions.get(session_id)):
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
        await _safe_send_session_message(
            session,
            "first_pass_languages_update",
            {
                "source_language": session.source_language,
                "target_language": session.target_language,
            },
        )

    return {
        "status": "ok",
        "source_language": session.source_language,
        "target_language": session.target_language,
    }


@router.post("/{session_id}/tts")
async def set_tts(session_id: str, request: TtsRequest):
    """Enable or disable dev TTS rendering for committed target text."""
    if not (session := _sessions.get(session_id)):
        return {"error": "Session not found"}

    session.tts_enabled = bool(request.enabled)
    await _safe_send_session_message(
        session,
        "tts_update",
        {"tts_enabled": session.tts_enabled},
    )

    return {
        "status": "ok",
        "tts_enabled": session.tts_enabled,
    }


@router.post("/{session_id}/start")
async def start_replay(session_id: str):
    """Start or resume playback."""
    if not (session := _sessions.get(session_id)):
        return {"error": "Session not found"}

    if session.status == "playing":
        return {"status": "already_playing"}

    if session.status == "completed":
        await _cancel_live_request_task(session)
        _reset_session_state(session)

    session.status = "playing"
    asyncio.create_task(_playback_loop(session))
    return {"status": "started"}


@router.post("/{session_id}/pause")
async def pause_replay(session_id: str):
    """Pause playback."""
    if not (session := _sessions.get(session_id)):
        return {"error": "Session not found"}

    if session.status != "playing":
        return {"status": "not_playing"}

    session.status = "paused"
    await _safe_send_session_message(
        session,
        "state_update",
        {
            "status": "paused",
            "event_index": session.current_event_index,
        },
    )

    return {"status": "paused"}


@router.post("/{session_id}/reset")
async def reset_replay(session_id: str):
    """Reset playback to the beginning and stop (go to idle state)."""
    if not (session := _sessions.get(session_id)):
        return {"error": "Session not found"}

    if session.status == "playing" and session.current_task:
        session.current_task.cancel()
        try:
            await session.current_task
        except asyncio.CancelledError:
            pass
    await _cancel_live_request_task(session)

    session.status = "idle"
    _reset_session_state(session)

    if session.websocket:
        try:
            await _safe_send_session_message(
                session,
                "state_update",
                {"status": "idle", "event_index": 1},
            )
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

    if not (session := _sessions.get(session_id)):
        await websocket.close(code=4001, reason="Session not found")
        return

    session.websocket = websocket

    try:
        preview = session.settings.preview_translation
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
                "second_pass_model": session.second_pass_model,
                "second_pass_enabled": bool(session.second_pass_model),
                "tts_enabled": session.tts_enabled,
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


@router.get("/{session_id}/tts/{artifact_id}")
async def get_tts_artifact(session_id: str, artifact_id: str):
    if not (session := _sessions.get(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        path = replay_tts_artifact_path(session.session_id, artifact_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="TTS artifact not found")
    if not path.exists():
        raise HTTPException(status_code=404, detail="TTS artifact not found")
    return FileResponse(
        path,
        media_type="audio/wav",
        filename=f"{artifact_id}.wav",
        content_disposition_type="inline",
    )


@router.get("/{session_id}/tts-combined")
async def get_tts_combined_artifact(session_id: str):
    if not (session := _sessions.get(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.tts_artifacts:
        raise HTTPException(status_code=404, detail="No TTS artifacts available")
    try:
        payload = build_replay_tts_combined_artifact(
            session_id=session.session_id,
            artifacts=session.tts_artifacts,
        )
        path = replay_tts_combined_artifact_path(session.session_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return FileResponse(
        path,
        media_type="audio/wav",
        filename=f"{session.session_id}-tts-combined.wav",
        content_disposition_type="inline",
        headers={
            "X-TTS-Artifact-Count": str(payload["artifact_count"]),
            "X-TTS-Duration-Ms": str(payload["duration_ms"]),
        },
    )


@router.get("/{session_id}/export")
async def export_final(session_id: str):
    """Export final snapshot with source, target, and metrics."""
    if not (session := _sessions.get(session_id)):
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
    second_pass_model = metrics_summary.get("second_pass_model", "")
    if len(session.models_used) > 1:
        model_slug = "mixed"
    elif second_pass_model and second_pass_model != first_pass_model:
        model_slug = f"{first_pass_model}_second-{second_pass_model}"
    else:
        model_slug = str(first_pass_model)
    filename = f"{stem}_{model_slug}_{timestamp}.txt"

    return PlainTextResponse(
        content,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
