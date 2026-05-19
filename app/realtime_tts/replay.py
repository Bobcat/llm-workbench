from __future__ import annotations

import asyncio
import base64
import shutil
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.realtime_translation.replay.events import SourceEventTiming
from app.realtime_translation.replay.events import load_pc_event_stream
from app.tts_pool.models import _request_json as _tts_pool_request_json

router = APIRouter(prefix="/realtime-tts/replay", tags=["realtime-tts"])

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_DIR = REPO_ROOT / "data" / "realtime_translation" / "sample"
ARTIFACT_ROOT = REPO_ROOT / "data" / "realtime_tts" / "replay_artifacts"


@dataclass(frozen=True)
class ReplaySpeakSegment:
    segment_index: int
    source_event_index: int
    line_number: int
    text: str
    timing: SourceEventTiming


@dataclass
class ReplaySpeakSession:
    session_id: str
    file_path: str
    segments: list[ReplaySpeakSegment]
    source_duration_ms: int
    status: str = "idle"
    current_segment_index: int = 1
    model: str = ""
    language: str = "English"
    voice_instructions: str = ""
    websocket: WebSocket | None = None
    current_task: asyncio.Task | None = None
    artifacts: list[dict[str, object]] = field(default_factory=list)


class CreateReplaySpeakSessionRequest(BaseModel):
    file_path: str
    model: str | None = None
    language: str | None = None
    voice_instructions: str | None = None


class ReplaySpeakOptionsRequest(BaseModel):
    model: str | None = None
    language: str | None = None
    voice_instructions: str | None = None


_sessions: dict[str, ReplaySpeakSession] = {}


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


def _resolve_file_path(raw_path: str) -> Path:
    path = Path(raw_path)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path


def _load_committed_segments(path: Path) -> tuple[list[ReplaySpeakSegment], int]:
    loaded = load_pc_event_stream(path)
    segments: list[ReplaySpeakSegment] = []
    for source_index, (event, timing) in enumerate(zip(loaded.events, loaded.timings), start=1):
        text = str(event.text or "")
        if event.kind != "c" or text.strip() == "":
            continue
        segments.append(
            ReplaySpeakSegment(
                segment_index=len(segments) + 1,
                source_event_index=source_index,
                line_number=int(event.line_number),
                text=text,
                timing=timing,
            )
        )
    return segments, int(max(0, loaded.source_duration_ms))


def _session_artifact_dir(session_id: str) -> Path:
    return ARTIFACT_ROOT / _safe_path_token(session_id)


def _artifact_path(session_id: str, artifact_id: str) -> Path:
    safe_id = _safe_path_token(artifact_id)
    return _session_artifact_dir(session_id) / f"{safe_id}.wav"


def _clear_artifacts(session_id: str) -> None:
    path = _session_artifact_dir(session_id)
    if path.exists():
        shutil.rmtree(path)


def _safe_path_token(value: str) -> str:
    token = "".join(
        char if char.isalnum() or char in {"-", "_"} else "_"
        for char in str(value or "")
    ).strip("_")
    if not token:
        raise ValueError("invalid path token")
    return token


def _segment_payload(segment: ReplaySpeakSegment) -> dict[str, object]:
    return {
        "segment_index": segment.segment_index,
        "source_event_index": segment.source_event_index,
        "line_number": segment.line_number,
        "text": segment.text,
        "speech_start_ms": int(segment.timing.speech_start_ms),
        "speech_end_ms": int(segment.timing.speech_end_ms),
    }


def _state_payload(session: ReplaySpeakSession, status: str | None = None, error: str | None = None) -> dict[str, object]:
    payload: dict[str, object] = {
        "status": status or session.status,
        "current_segment_index": session.current_segment_index,
        "segment_count": len(session.segments),
        "artifact_count": len(session.artifacts),
        "model": session.model,
        "language": session.language,
    }
    if error:
        payload["error"] = error
    return payload


async def _safe_send_session_message(
    session: ReplaySpeakSession,
    message_type: str,
    data: dict[str, object],
) -> None:
    if not session.websocket:
        return
    try:
        await session.websocket.send_json({"type": message_type, "data": data})
    except Exception:
        session.websocket = None


def _apply_options(session: ReplaySpeakSession, request: ReplaySpeakOptionsRequest) -> None:
    if request.model is not None:
        session.model = str(request.model or "").strip()
    if request.language is not None:
        language = str(request.language or "").strip()
        if not language:
            raise HTTPException(status_code=400, detail="language must not be empty")
        session.language = language
    if request.voice_instructions is not None:
        session.voice_instructions = str(request.voice_instructions or "").strip()


def _build_tts_request(session: ReplaySpeakSession, segment: ReplaySpeakSegment) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": session.model,
        "input": segment.text,
        "language": session.language,
        "format": {"type": "wav"},
        "stream": False,
    }
    if session.voice_instructions:
        payload["voice"] = {"instructions": session.voice_instructions}
    return payload


def _synthesize_segment(session: ReplaySpeakSession, segment: ReplaySpeakSegment) -> dict[str, object]:
    if not session.model:
        raise ValueError("TTS model is required")

    started_at = time.perf_counter()
    response = _tts_pool_request_json(
        method="POST",
        path="/v1/responses",
        payload=_build_tts_request(session, segment),
        timeout=180.0,
    )
    wall_ms = max(0.0, (time.perf_counter() - started_at) * 1000.0)

    audio = response.get("audio")
    if not isinstance(audio, dict):
        raise ValueError("tts-pool response did not include audio")
    data_base64 = str(audio.get("data_base64") or "")
    if not data_base64:
        raise ValueError("tts-pool response did not include audio data")
    try:
        wav_bytes = base64.b64decode(data_base64, validate=True)
    except Exception as exc:
        raise ValueError("tts-pool response audio was not valid base64") from exc

    artifact_id = f"{segment.segment_index:04d}-{uuid.uuid4().hex[:10]}"
    artifact_path = _artifact_path(session.session_id, artifact_id)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_path.write_bytes(wav_bytes)

    payload = {
        "artifact_id": artifact_id,
        "audio_url": f"/api/realtime-tts/replay/{session.session_id}/audio/{artifact_id}",
        "mime_type": str(audio.get("mime_type") or "audio/wav"),
        "sample_rate_hz": audio.get("sample_rate_hz"),
        "duration_ms": audio.get("duration_ms"),
        "response_id": response.get("id"),
        "model": response.get("model") or session.model,
        "wall_ms": wall_ms,
        "metrics": response.get("metrics") if isinstance(response.get("metrics"), dict) else {},
        "metadata": response.get("metadata") if isinstance(response.get("metadata"), dict) else {},
    }
    session.artifacts.append(payload)
    return payload


async def _playback_loop(session: ReplaySpeakSession) -> None:
    session.current_task = asyncio.current_task()
    await _safe_send_session_message(session, "state_update", _state_payload(session, "playing"))
    playback_error: str | None = None

    try:
        while session.status == "playing" and session.current_segment_index <= len(session.segments):
            segment = session.segments[session.current_segment_index - 1]
            await _safe_send_session_message(session, "segment_start", _segment_payload(segment))
            try:
                artifact = await asyncio.to_thread(_synthesize_segment, session, segment)
            except Exception as exc:
                session.status = "error"
                playback_error = str(exc) or exc.__class__.__name__
                await _safe_send_session_message(
                    session,
                    "segment_error",
                    {
                        **_segment_payload(segment),
                        "error": playback_error,
                    },
                )
                break

            await _safe_send_session_message(
                session,
                "segment_audio",
                {
                    **_segment_payload(segment),
                    "artifact": artifact,
                },
            )
            session.current_segment_index += 1
    except asyncio.CancelledError:
        return
    finally:
        session.current_task = None

    if session.status == "error":
        await _safe_send_session_message(session, "state_update", _state_payload(session, "error", playback_error))
        return
    if session.status == "playing" and session.current_segment_index > len(session.segments):
        session.status = "completed"
    elif session.status == "playing":
        session.status = "paused"
    await _safe_send_session_message(session, "state_update", _state_payload(session))


@router.get("/samples")
async def list_sample_files() -> dict[str, object]:
    return {"samples": _sample_file_items()}


@router.post("/session")
async def create_session(request: CreateReplaySpeakSessionRequest) -> dict[str, object]:
    session_id = str(uuid.uuid4())
    path = _resolve_file_path(request.file_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail={"error": "file_not_found", "path": str(path)})
    try:
        segments, source_duration_ms = _load_committed_segments(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    session = ReplaySpeakSession(
        session_id=session_id,
        file_path=str(path),
        segments=segments,
        source_duration_ms=source_duration_ms,
    )
    _apply_options(
        session,
        ReplaySpeakOptionsRequest(
            model=request.model,
            language=request.language,
            voice_instructions=request.voice_instructions,
        ),
    )
    _sessions[session_id] = session
    _clear_artifacts(session_id)

    return {
        "session_id": session_id,
        "segment_count": len(session.segments),
        "source_duration_ms": session.source_duration_ms,
        "model": session.model,
        "language": session.language,
        "voice_instructions": session.voice_instructions,
    }


@router.post("/{session_id}/options")
async def set_options(session_id: str, request: ReplaySpeakOptionsRequest) -> dict[str, object]:
    if not (session := _sessions.get(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status == "playing":
        raise HTTPException(status_code=409, detail="Options can only be changed while not playing")
    _apply_options(session, request)
    await _safe_send_session_message(
        session,
        "options_update",
        {
            "model": session.model,
            "language": session.language,
            "voice_instructions": session.voice_instructions,
        },
    )
    return {
        "status": "ok",
        "model": session.model,
        "language": session.language,
        "voice_instructions": session.voice_instructions,
    }


@router.post("/{session_id}/start")
async def start(session_id: str) -> dict[str, object]:
    if not (session := _sessions.get(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")
    if not session.model:
        raise HTTPException(status_code=400, detail="TTS model is required")
    if session.status == "playing":
        return {"status": "already_playing"}
    if session.status == "completed":
        session.current_segment_index = 1
        session.artifacts.clear()
        _clear_artifacts(session.session_id)
    session.status = "playing"
    if session.current_task and not session.current_task.done():
        await _safe_send_session_message(session, "state_update", _state_payload(session, "playing"))
        return {"status": "resumed"}
    asyncio.create_task(_playback_loop(session))
    return {"status": "started"}


@router.post("/{session_id}/pause")
async def pause(session_id: str) -> dict[str, object]:
    if not (session := _sessions.get(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != "playing":
        return {"status": "not_playing"}
    session.status = "paused"
    await _safe_send_session_message(session, "state_update", _state_payload(session, "paused"))
    return {"status": "paused"}


@router.post("/{session_id}/reset")
async def reset(session_id: str) -> dict[str, object]:
    if not (session := _sessions.get(session_id)):
        raise HTTPException(status_code=404, detail="Session not found")
    if session.current_task:
        session.current_task.cancel()
        try:
            await session.current_task
        except asyncio.CancelledError:
            pass
    session.status = "idle"
    session.current_segment_index = 1
    session.artifacts.clear()
    _clear_artifacts(session.session_id)
    await _safe_send_session_message(session, "state_update", _state_payload(session, "idle"))
    return {"status": "reset"}


@router.get("/{session_id}/audio/{artifact_id}")
async def get_artifact(session_id: str, artifact_id: str):
    if not _sessions.get(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        path = _artifact_path(session_id, artifact_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Artifact not found")
    if not path.exists():
        raise HTTPException(status_code=404, detail="Artifact not found")
    return FileResponse(
        path,
        media_type="audio/wav",
        filename=f"{artifact_id}.wav",
        content_disposition_type="inline",
    )


async def websocket_endpoint(websocket: WebSocket, session_id: str) -> None:
    await websocket.accept()
    if not (session := _sessions.get(session_id)):
        await websocket.close(code=4001, reason="Session not found")
        return

    session.websocket = websocket
    try:
        await websocket.send_json({
            "type": "session_info",
            "data": {
                "session_id": session.session_id,
                "file_path": session.file_path,
                "segment_count": len(session.segments),
                "source_duration_ms": session.source_duration_ms,
                "status": session.status,
                "current_segment_index": session.current_segment_index,
                "model": session.model,
                "language": session.language,
                "voice_instructions": session.voice_instructions,
                "segments": [_segment_payload(segment) for segment in session.segments],
            },
        })
        await websocket.send_json({"type": "state_update", "data": _state_payload(session)})
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        session.websocket = None
    except Exception:
        session.websocket = None
