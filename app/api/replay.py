from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Dict, Optional
import uuid
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.events import ReplayEvent, load_pc_events
from app.core import TranslationCore
from app.promptlib import FilePromptLibraryStore, PromptNotFoundError, PromptRecord
from app.source_state import SourceTranscriptState
from app.translators import build_translator
from app.replay_settings import load_replay_settings

router = APIRouter(prefix="/replay", tags=["replay"])
DEFAULT_FIRST_PASS_PROMPT_ID = "translation/first-pass/current-default"

# Speed presets (ms delay tussen events)
SPEED_PRESETS = {
    "slow": 900,
    "normal": 500,
    "fast": 200,
    "fastest": 1,
}

# In-memory session storage
_sessions: Dict[str, "ReplaySession"] = {}
_prompt_store = FilePromptLibraryStore()


@dataclass
class TraceRecord:
    """Record of a single event processing with metrics."""
    event_index: int
    event_kind: str
    event_text: str
    line_number: int
    triggered: bool
    reason: str
    source_window: str
    request_id: str
    model: str
    first_pass_model: str
    correction_model: str
    # Metrics
    replay_request_wall_ms: float | None = None
    observed_first_text_ms: float | None = None
    observed_complete_ms: float | None = None
    transport_first_byte_ms: float | None = None
    transport_first_text_delta_ms: float | None = None
    transport_completed_ms: float | None = None
    engine_tokenize_ms: float | None = None
    gpu_time_to_first_token_ms: float | None = None
    gpu_generate_total_ms: float | None = None
    gpu_decode_after_first_token_ms: float | None = None
    engine_tokens_per_second: float | None = None


@dataclass
class ReplaySession:
    session_id: str
    events: list[ReplayEvent]
    file_path: str = ""  # Path to the .pc file
    current_event_index: int = 1
    status: str = "idle"
    speed: str = "normal"
    model: Optional[str] = None  # Selected model for translations
    correction_model: str = ""  # Empty string means correction is off
    first_pass_prompt_id: str = DEFAULT_FIRST_PASS_PROMPT_ID
    first_pass_system_prompt: str = ""
    first_pass_user_prompt: str = "{{source_window}}"
    websocket: WebSocket | None = None
    source_committed_text: str = ""
    source_preview_text: str = ""
    current_task: asyncio.Task | None = None  # Reference to running playback task
    
    # Translation state
    target_committed_text: str = ""
    target_preview_text: str = ""
    core: TranslationCore | None = None
    
    # Traces for metrics export
    traces: list[TraceRecord] = field(default_factory=list)
    
    # Track all models used during session (for export accuracy)
    models_used: set[str] = field(default_factory=set)
    correction_models_used: set[str] = field(default_factory=set)
    
    def init_core(self, translator):
        """Initialize TranslationCore with translator."""
        settings = load_replay_settings()
        self.core = TranslationCore(
            translator=translator,
            preview_settings=settings.preview_translation,
            commit_correction_enabled=bool(self.correction_model),
            commit_correction_prompt=settings.commit_correction.prompt,
            no_translator_mode=self.model is None,
        )
    
    def get_source_state(self) -> SourceTranscriptState:
        """Get current source state for TranslationCore."""
        return SourceTranscriptState(
            source_committed_text=self.source_committed_text,
            source_preview_text=self.source_preview_text,
        )
    
    def update_source(self, event: ReplayEvent):
        if event.kind == "c":
            self.source_committed_text += event.text
            self.source_preview_text = ""
        elif event.kind == "p":
            self.source_preview_text = event.text
    
    def get_delay_ms(self) -> int:
        return SPEED_PRESETS.get(self.speed, 500)
    
    def get_model_display(self) -> str:
        return self.model or "(none)"
    
    def swap_translator(self):
        """Swap the translator in the existing core without losing state.
        
        This preserves all internal TranslationCore state (target text,
        open chunks, etc.) while switching to the new model.
        """
        if not self.core:
            return

        if self.model is None:
            settings = load_replay_settings()
            translator = _build_replay_translator(
                service_model=settings.first_pass.default_model,
                correction_model=self.correction_model,
                first_pass_prompt=self.first_pass_system_prompt,
                first_pass_input_template=self.first_pass_user_prompt,
            )
            self.core.set_translator(translator)
            self.core.no_translator_mode = True
            self.core.commit_correction_enabled = bool(self.correction_model)
            return

        translator = _build_replay_translator(
            service_model=self.model,
            correction_model=self.correction_model,
            first_pass_prompt=self.first_pass_system_prompt,
            first_pass_input_template=self.first_pass_user_prompt,
        )
        # Swap translator only - preserve all core state
        self.core.set_translator(translator)
        self.core.no_translator_mode = False
        self.core.commit_correction_enabled = bool(self.correction_model)


class CreateSessionRequest(BaseModel):
    file_path: str


class SpeedRequest(BaseModel):
    speed: str


class ModelRequest(BaseModel):
    model: str  # Empty string means no translator


class CorrectionModelRequest(BaseModel):
    model: str  # Empty string means Off


class FirstPassPromptRequest(BaseModel):
    prompt_id: str


def _is_first_pass_prompt(record: PromptRecord) -> bool:
    translation_section = record.sections.get("translation", {})
    if not isinstance(translation_section, dict):
        return False
    stage = str(translation_section.get("stage", "")).strip().lower()
    return stage == "first_pass"


def _load_first_pass_prompt(prompt_id: str) -> PromptRecord:
    _prompt_store.reload()
    try:
        record = _prompt_store.get_prompt(prompt_id)
    except PromptNotFoundError as exc:
        raise ValueError(str(exc)) from exc
    if not record.enabled:
        raise ValueError(f"Prompt {prompt_id!r} is disabled.")
    if not _is_first_pass_prompt(record):
        raise ValueError(f"Prompt {prompt_id!r} is not a first-pass translation prompt.")
    return record


def _apply_first_pass_prompt(session: ReplaySession, prompt: PromptRecord) -> None:
    session.first_pass_prompt_id = prompt.id
    session.first_pass_system_prompt = prompt.system_prompt
    session.first_pass_user_prompt = prompt.prompt_text


def _build_replay_translator(
    *,
    service_model: str | None,
    correction_model: str,
    first_pass_prompt: str,
    first_pass_input_template: str,
):
    settings = load_replay_settings()
    return build_translator(
        "ct2-eurollm",
        dummy_mode="marker",
        service_model=service_model,
        correction_model=correction_model,
        first_pass_prompt=first_pass_prompt,
        first_pass_input_template=first_pass_input_template,
        first_pass_inline_user_prompt=True,
        correction_inline_user_prompt=True,
        correction_input_template=settings.commit_correction.input_template,
    )


@router.post("/session")
async def create_session(request: CreateSessionRequest):
    """Create a new replay session from .pc file."""
    session_id = str(uuid.uuid4())
    path = Path(request.file_path)
    
    if not path.is_absolute():
        path = Path(__file__).parent.parent.parent / path
    
    if not path.exists():
        return {"error": "File not found", "path": str(path.absolute())}
    
    events = load_pc_events(path)
    settings = load_replay_settings()
    try:
        default_prompt = _load_first_pass_prompt(DEFAULT_FIRST_PASS_PROMPT_ID)
    except ValueError as exc:
        return {"error": str(exc)}
    
    session = ReplaySession(
        session_id=session_id,
        events=list(events),
        file_path=str(path)
    )
    session.correction_model = (
        settings.commit_correction.model if settings.commit_correction.enabled else ""
    )
    _apply_first_pass_prompt(session, default_prompt)
    
    # Initialize translator (will be rebuilt when model changes)
    translator = _build_replay_translator(
        service_model=settings.first_pass.default_model,
        correction_model=session.correction_model,
        first_pass_prompt=session.first_pass_system_prompt,
        first_pass_input_template=session.first_pass_user_prompt,
    )
    session.init_core(translator)
    
    _sessions[session_id] = session
    
    return {
        "session_id": session_id,
        "event_count": len(events),
        "first_pass_prompt_id": session.first_pass_prompt_id,
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
        "delay_ms": session.get_delay_ms()
    }


@router.post("/{session_id}/model")
async def set_model(session_id: str, request: ModelRequest):
    """Set model for translations. Empty string = no translator (passthrough)."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}
    
    # Empty string becomes None (default)
    new_model = request.model if request.model else None
    
    # Only swap if model actually changed
    if new_model != session.model:
        session.model = new_model
        # Swap translator in existing core - preserves all state
        session.swap_translator()
    
    # Notify client via WebSocket if connected
    if session.websocket:
        try:
            await session.websocket.send_json({
                "type": "model_update",
                "data": {
                    "model": session.get_model_display()
                }
            })
        except Exception:
            pass
    
    return {
        "status": "ok",
        "model": session.get_model_display()
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


@router.post("/{session_id}/start")
async def start_replay(session_id: str):
    """Start or resume playback."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}
    
    if session.status == "playing":
        return {"status": "already_playing"}
    
    if session.status == "completed":
        # Restart from beginning - reset ALL state (same as reset endpoint)
        session.current_event_index = 1
        session.source_committed_text = ""
        session.source_preview_text = ""
        session.target_committed_text = ""
        session.target_preview_text = ""
        session.traces.clear()
        session.models_used.clear()
        session.correction_models_used.clear()
        
        # Reset TranslationCore state
        if session.core:
            session.core.target_state.target_committed_text = ""
            session.core.target_state.target_preview_text = ""
            session.core.open_source_chunks.clear()
            session.core._reset_preview_run_state()
    
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
    
    # Notify client via WebSocket
    if session.websocket:
        try:
            await session.websocket.send_json({
                "type": "state_update",
                "data": {
                    "status": "paused",
                    "event_index": session.current_event_index
                }
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
    
    # Stop current playback if running
    if session.status == "playing" and session.current_task:
        session.current_task.cancel()
        try:
            await session.current_task
        except asyncio.CancelledError:
            pass
    
    # Reset to beginning
    session.status = "idle"
    session.current_event_index = 1
    session.source_committed_text = ""
    session.source_preview_text = ""
    session.target_committed_text = ""
    session.target_preview_text = ""
    session.traces.clear()  # Clear metrics history
    session.models_used.clear()  # Clear model tracking
    session.correction_models_used.clear()  # Clear correction model tracking
    
    # Reset TranslationCore state if exists
    if session.core:
        session.core.target_state.target_committed_text = ""
        session.core.target_state.target_preview_text = ""
        session.core.open_source_chunks.clear()
        session.core._reset_preview_run_state()
    
    # Notify client
    if session.websocket:
        try:
            await session.websocket.send_json({
                "type": "state_update",
                "data": {
                    "status": "idle",
                    "event_index": 1
                }
            })
            await session.websocket.send_json({
                "type": "source_update",
                "data": {
                    "committed": "",
                    "preview": "",
                    "event_index": 1,
                    "line_number": 0,
                    "kind": "reset",
                    "model": session.get_model_display(),
                    "status": "idle"
                }
            })
            await session.websocket.send_json({
                "type": "target_update",
                "data": {
                    "committed": "",
                    "preview": "",
                    "event_index": 1,
                    "triggered": False,
                    "reason": "",
                }
            })
        except Exception:
            pass
    
    return {"status": "reset"}


async def _playback_loop(session: ReplaySession):
    """Playback loop with configurable speed."""
    # Store reference to this task
    session.current_task = asyncio.current_task()
    
    # Send initial state_update when playback starts
    if session.websocket:
        try:
            await session.websocket.send_json({
                "type": "state_update",
                "data": {
                    "status": "playing",
                    "event_index": session.current_event_index
                }
            })
        except Exception:
            pass
    
    playback_error: str | None = None
    try:
        while session.status == "playing" and session.current_event_index <= len(session.events):
            event = session.events[session.current_event_index - 1]
            
            # Update source state
            session.update_source(event)
            
            # Process translation (blocking call) and measure latency
            translation_triggered = False
            translation_wall_ms = 0.0
            decision = None
            if session.core:
                source_state = session.get_source_state()
                started = time.perf_counter()
                try:
                    decision = session.core.handle_event(event, source_state)
                except Exception as exc:
                    session.status = "error"
                    playback_error = str(exc)
                    break
                translation_wall_ms = (time.perf_counter() - started) * 1000.0
                if decision.triggered:
                    translation_triggered = True
                    session.target_committed_text = session.core.target_state.target_committed_text
                    session.target_preview_text = session.core.target_state.target_preview_text
            
            # Store trace record for metrics export (only if translation happened)
            if decision and decision.triggered:
                # Track first-pass model usage; mixed should only reflect first-pass switches.
                first_pass_model = decision.first_pass_model or decision.model
                if first_pass_model:
                    session.models_used.add(first_pass_model)
                if decision.correction_model:
                    session.correction_models_used.add(decision.correction_model)
                metrics = decision.metrics
                trace = TraceRecord(
                    event_index=session.current_event_index,
                    event_kind=event.kind,
                    event_text=event.text,
                    line_number=event.line_number,
                    triggered=decision.triggered,
                    reason=decision.reason,
                    source_window=decision.source_window,
                    request_id=decision.request_id,
                    model=decision.model,
                    first_pass_model=first_pass_model,
                    correction_model=decision.correction_model,
                    replay_request_wall_ms=metrics.replay_request_wall_ms,
                    observed_first_text_ms=metrics.observed_first_text_ms,
                    observed_complete_ms=metrics.observed_complete_ms,
                    transport_first_byte_ms=metrics.transport_first_byte_ms,
                    transport_first_text_delta_ms=metrics.transport_first_text_delta_ms,
                    transport_completed_ms=metrics.transport_completed_ms,
                    engine_tokenize_ms=metrics.engine_tokenize_ms,
                    gpu_time_to_first_token_ms=metrics.gpu_time_to_first_token_ms,
                    gpu_generate_total_ms=metrics.gpu_generate_total_ms,
                    gpu_decode_after_first_token_ms=metrics.gpu_decode_after_first_token_ms,
                    engine_tokens_per_second=metrics.engine_tokens_per_second,
                )
                session.traces.append(trace)
            
            if session.websocket:
                try:
                    # Send source update
                    await session.websocket.send_json({
                        "type": "source_update",
                        "data": {
                            "committed": session.source_committed_text,
                            "preview": session.source_preview_text,
                            "event_index": session.current_event_index,
                            "line_number": event.line_number,
                            "kind": event.kind,
                            "model": session.get_model_display(),
                            "status": "playing"
                        }
                    })
                    
                    # Send target update (always, so UI knows if translation happened)
                    await session.websocket.send_json({
                        "type": "target_update",
                        "data": {
                            "committed": session.target_committed_text,
                            "preview": session.target_preview_text,
                            "event_index": session.current_event_index,
                            "triggered": translation_triggered,
                            "reason": decision.reason if decision else "",
                            "wall_ms": round(translation_wall_ms, 1) if translation_triggered else 0.0,
                        }
                    })
                except Exception:
                    session.websocket = None
                    break
            
            session.current_event_index += 1
            
            delay_ms = session.get_delay_ms()
            await asyncio.sleep(delay_ms / 1000.0)
    
    except asyncio.CancelledError:
        # Loop was cancelled (e.g., by restart)
        pass
    
    # Playback ended - send final state_update
    if session.status == "error":
        final_status = "error"
    else:
        final_status = "completed" if session.current_event_index > len(session.events) else "paused"
    session.status = final_status
    
    if session.websocket:
        try:
            state_payload = {
                "status": final_status,
                "event_index": min(session.current_event_index, len(session.events))
            }
            if playback_error:
                state_payload["error"] = playback_error
            await session.websocket.send_json({
                "type": "state_update",
                "data": state_payload
            })
        except Exception:
            pass


async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket for real-time source updates."""
    await websocket.accept()
    
    session = _sessions.get(session_id)
    if not session:
        await websocket.close(code=4001, reason="Session not found")
        return
    
    session.websocket = websocket
    
    try:
        # Load settings for params label
        settings = load_replay_settings()
        preview = settings.preview_translation
        params_label = f"sentence_gate=source; preview=min_chars={preview.min_chars}, ratio<={preview.max_distance_ratio:.2f}, growth>={preview.min_growth_chars}"
        
        # Send session info
        await websocket.send_json({
            "type": "session_info",
            "data": {
                "total_events": len(session.events),
                "file_path": session.file_path,
                "params": params_label,
                "correction_model": session.correction_model,
                "correction_enabled": bool(session.correction_model),
            }
        })
        
        # Send initial state with model
        current_event = session.events[session.current_event_index - 1] if session.events else None
        await websocket.send_json({
            "type": "source_update",
            "data": {
                "committed": session.source_committed_text,
                "preview": session.source_preview_text,
                "event_index": session.current_event_index,
                "line_number": current_event.line_number if current_event else 0,
                "kind": current_event.kind if current_event else "",
                "status": session.status,
                "model": session.get_model_display()
            }
        })
        # Send initial target state
        await websocket.send_json({
            "type": "target_update",
            "data": {
                "committed": session.target_committed_text,
                "preview": session.target_preview_text,
                "event_index": session.current_event_index,
                "triggered": False,
                "reason": "",
            }
        })
        
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
                
    except WebSocketDisconnect:
        session.websocket = None
    except Exception:
        session.websocket = None


def _metric_values(traces: list[TraceRecord], name: str) -> list[float]:
    """Extract metric values from traces."""
    values: list[float] = []
    for trace in traces:
        value = getattr(trace, name)
        if value is not None:
            values.append(float(value))
    return values


def _percentile(values: list[float], fraction: float) -> float:
    """Calculate percentile from sorted values."""
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def _summarize_metric(values: list[float]) -> dict[str, float | int] | None:
    """Calculate summary statistics for a metric."""
    if not values:
        return None
    ordered = sorted(values)
    return {
        "count": len(ordered),
        "avg": sum(ordered) / len(ordered),
        "p50": _percentile(ordered, 0.50),
        "p95": _percentile(ordered, 0.95),
    }


def _build_metrics_summary(*, session: ReplaySession, traces: list[TraceRecord]) -> dict[str, object]:
    """Build metrics summary exactly like the original."""
    translated_traces = [trace for trace in traces if trace.triggered]
    preview_translations = sum(1 for trace in translated_traces if trace.event_kind == "p")
    commit_translations = sum(1 for trace in translated_traces if trace.event_kind == "c")
    settings = load_replay_settings()
    default_first_pass_model = settings.first_pass.default_model
    configured_correction_model = session.correction_model
    
    # Determine first-pass model display: single model, mixed models, or default.
    if len(session.models_used) > 1:
        model_display = "<mixed models>"
    elif len(session.models_used) == 1:
        model_display = next(iter(session.models_used))
    else:
        model_display = session.model or default_first_pass_model

    # Determine correction model display independently from first-pass model usage.
    if len(session.correction_models_used) > 1:
        correction_model_display = "<mixed correction models>"
    elif len(session.correction_models_used) == 1:
        correction_model_display = next(iter(session.correction_models_used))
    else:
        correction_model_display = configured_correction_model
    
    return {
        "sample_file": session.file_path,
        "model": model_display,
        "correction_model": correction_model_display,
        "events_total": len(session.events),
        "translations_total": len(translated_traces),
        "preview_translations": preview_translations,
        "commit_translations": commit_translations,
        "metrics": {
            "replay_request_wall_ms": _summarize_metric(_metric_values(translated_traces, "replay_request_wall_ms")),
            "observed_first_text_ms": _summarize_metric(_metric_values(translated_traces, "observed_first_text_ms")),
            "observed_complete_ms": _summarize_metric(_metric_values(translated_traces, "observed_complete_ms")),
            "transport_first_byte_ms": _summarize_metric(_metric_values(translated_traces, "transport_first_byte_ms")),
            "transport_first_text_delta_ms": _summarize_metric(_metric_values(translated_traces, "transport_first_text_delta_ms")),
            "transport_completed_ms": _summarize_metric(_metric_values(translated_traces, "transport_completed_ms")),
            "engine_tokenize_ms": _summarize_metric(_metric_values(translated_traces, "engine_tokenize_ms")),
            "gpu_time_to_first_token_ms": _summarize_metric(_metric_values(translated_traces, "gpu_time_to_first_token_ms")),
            "gpu_generate_total_ms": _summarize_metric(_metric_values(translated_traces, "gpu_generate_total_ms")),
            "gpu_decode_after_first_token_ms": _summarize_metric(_metric_values(translated_traces, "gpu_decode_after_first_token_ms")),
            "engine_tokens_per_second": _summarize_metric(_metric_values(translated_traces, "engine_tokens_per_second")),
        },
    }


def _build_metrics_summary_lines(metrics_summary: dict[str, object]) -> list[str]:
    """Build metrics summary lines exactly like the original."""
    metrics_payload = metrics_summary.get("metrics", {})
    if not isinstance(metrics_payload, dict):
        metrics_payload = {}
    
    lines = [
        f"Sample file: {metrics_summary.get('sample_file', '')}",
        f"Model: {metrics_summary.get('model', '') or '(default)'}",
        f"Correction model: {metrics_summary.get('correction_model', '') or '(none)'}",
        f"Events total: {metrics_summary.get('events_total', 0)}",
        f"Translations total: {metrics_summary.get('translations_total', 0)}",
        f"Preview translations: {metrics_summary.get('preview_translations', 0)}",
        f"Commit translations: {metrics_summary.get('commit_translations', 0)}",
    ]
    
    for metric_name in (
        "replay_request_wall_ms",
        "observed_first_text_ms",
        "observed_complete_ms",
        "transport_completed_ms",
        "gpu_time_to_first_token_ms",
        "gpu_generate_total_ms",
        "engine_tokens_per_second",
    ):
        summary = metrics_payload.get(metric_name)
        if not isinstance(summary, dict) or not summary:
            continue
        avg_value = summary.get("avg")
        p50_value = summary.get("p50")
        p95_value = summary.get("p95")
        if avg_value is None or p50_value is None or p95_value is None:
            continue
        lines.append(
            f"{metric_name}: avg={avg_value:.1f} p50={p50_value:.1f} p95={p95_value:.1f}"
        )
    
    return lines


@router.get("/{session_id}/export")
async def export_final(session_id: str):
    """Export final snapshot with source, target, and metrics."""
    session = _sessions.get(session_id)
    if not session:
        return {"error": "Session not found"}
    
    if not session.events:
        return {"error": "No events in session"}
    
    # Build visible text (committed + preview with space handling)
    def _visible_text(committed: str, preview: str) -> str:
        if not committed or not preview:
            return f"{committed}{preview}"
        if committed.endswith((" ", "\n")) or preview.startswith((" ", "\n")):
            return f"{committed}{preview}"
        return f"{committed} {preview}"
    
    source_text = _visible_text(session.source_committed_text, session.source_preview_text)
    target_text = _visible_text(session.target_committed_text, session.target_preview_text)
    
    # Build metrics summary
    metrics_summary = _build_metrics_summary(session=session, traces=session.traces)
    summary_lines = _build_metrics_summary_lines(metrics_summary)
    
    # Build content exactly like original
    lines = [
        "Metrics",
        *summary_lines,
        "",
        "Source",
        source_text if source_text else "(empty)",
        "",
        "Target",
        target_text if target_text else "(empty)",
        "",
    ]
    
    content = "\n".join(lines)
    
    # Generate filename
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
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
