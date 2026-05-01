from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Dict, Optional
from pathlib import Path


from app.realtime_translation.replay.live_dispatch import execute_live_dispatch_request
from app.realtime_translation.replay.events import load_pc_events
from app.realtime_translation.replay.prompt_selection import _apply_first_pass_prompt
from app.realtime_translation.replay.prompt_selection import _apply_second_pass_prompt
from app.realtime_translation.replay.prompt_selection import _load_first_pass_prompt
from app.realtime_translation.replay.prompt_selection import _load_second_pass_prompt
from app.realtime_translation.replay.transport import _send_source_update
from app.realtime_translation.replay.transport import _send_state_update
from app.realtime_translation.replay.transport import _send_target_update
from app.realtime_translation.replay.transport import _send_translation_outcome
from app.realtime_translation.replay.settings import ReplaySettings
from realtime_translation_engine import LiveDispatchRequest
from realtime_translation_engine import LiveRunner
from realtime_translation_engine import SourceEvent
from realtime_translation_engine import SourceTranscriptState
from promptlib import PromptRecord
from realtime_translation_engine import ReplayRunner
from realtime_translation_engine import TranslationCore
from realtime_translation_engine import TranslationDecision
from realtime_translation_engine.translators import build_translator

DEFAULT_FIRST_PASS_PROMPT_ID = "translation/first-pass/current-default"
DEFAULT_SECOND_PASS_PROMPT_ID = "translation/second-pass/current-default"

# Speed presets (ms delay tussen events)
SPEED_PRESETS = {
    "slow": 900,
    "normal": 500,
    "fast": 200,
    "fast2": 150,
    "fast3": 100,
    "fast4": 75,
    "fast5": 50,
    "fast6": 25,
    "fast7": 10,
    "fastest": 1,
}
REPLAY_POLICIES = {"replay", "live"}

# In-memory session storage
_sessions: Dict[str, "ReplaySession"] = {}


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
    second_pass_model: str
    # Metrics
    replay_request_wall_ms: float | None = None
    observed_first_text_ms: float | None = None
    observed_complete_ms: float | None = None
    transport_first_byte_ms: float | None = None
    transport_first_text_delta_ms: float | None = None
    transport_completed_ms: float | None = None
    engine_queue_wait_ms: float | None = None
    backend_inference_wall_ms: float | None = None
    engine_total_wall_ms: float | None = None
    engine_outside_backend_wall_ms: float | None = None
    pool_total_wall_ms: float | None = None
    engine_tokenize_ms: float | None = None
    gpu_time_to_first_token_ms: float | None = None
    gpu_generate_total_ms: float | None = None
    gpu_decode_after_first_token_ms: float | None = None
    engine_tokens_per_second: float | None = None


@dataclass
class ReplaySession:
    session_id: str
    events: list[SourceEvent]
    settings: ReplaySettings
    file_path: str = ""  # Path to the .pc file
    current_event_index: int = 1
    source_revision: int = 0
    target_revision: int = 0
    status: str = "idle"
    speed: str = "normal"
    policy: str = "replay"
    model: Optional[str] = None  # Selected model for translations
    second_pass_model: str = ""  # Empty string means second pass is off
    first_pass_prompt_id: str = DEFAULT_FIRST_PASS_PROMPT_ID
    first_pass_system_prompt: str = ""
    first_pass_user_prompt: str = "{{source_window}}"
    second_pass_prompt_id: str = DEFAULT_SECOND_PASS_PROMPT_ID
    second_pass_system_prompt: str = ""
    second_pass_user_prompt: str = "{{draft_translation}}"
    source_language: str = "English"
    target_language: str = "Dutch"
    tts_enabled: bool = False
    websocket: WebSocket | None = None
    source_committed_text: str = ""
    source_preview_text: str = ""
    current_task: asyncio.Task | None = None  # Reference to running playback task
    live_request_task: asyncio.Task | None = None
    
    # Translation state
    target_committed_text: str = ""
    target_preview_text: str = ""
    last_sent_source_committed_text: str = ""
    last_sent_target_committed_text: str = ""
    runner: ReplayRunner | LiveRunner | None = None
    
    # Traces for metrics export
    traces: list[TraceRecord] = field(default_factory=list)
    tts_artifacts: list[dict[str, object]] = field(default_factory=list)
    
    # Track all models used during session (for export accuracy)
    models_used: set[str] = field(default_factory=set)
    second_pass_models_used: set[str] = field(default_factory=set)
    
    def build_translator(self):
        service_model = (
            self.model
            if self.model is not None
            else self.settings.first_pass.default_model
        )
        return _build_replay_translator(
            service_model=service_model,
            second_pass_model=self.second_pass_model,
            first_pass_prompt=self.first_pass_system_prompt,
            first_pass_input_template=self.first_pass_user_prompt,
            second_pass_input_template=self.second_pass_user_prompt,
            source_language=self.source_language,
            target_language=self.target_language,
        )

    def init_runner(self):
        """Initialize runner for the selected policy."""
        core = TranslationCore(preview_settings=self.settings.preview_translation)
        if self.policy == "live":
            self.runner = LiveRunner(core=core)
            return
        self.runner = ReplayRunner(
            translator=self.build_translator(),
            core=core,
            second_pass_enabled=bool(self.second_pass_model),
            second_pass_prompt=self.second_pass_system_prompt,
            no_translator_mode=self.model is None,
        )
    
    def get_source_state(self) -> SourceTranscriptState:
        """Get current source state for replay translation processing."""
        return SourceTranscriptState(
            source_committed_text=self.source_committed_text,
            source_preview_text=self.source_preview_text,
        )
    
    def update_source(self, event: SourceEvent):
        state = self.get_source_state()
        state.apply_event(event)
        self.source_committed_text = state.source_committed_text
        self.source_preview_text = state.source_preview_text
    
    def get_delay_ms(self) -> int:
        return SPEED_PRESETS.get(self.speed, 500)
    
    def get_model_display(self) -> str:
        return self.model or "(none)"
    
    @classmethod
    def create(
        cls,
        *,
        session_id: str,
        file_path: Path,
        settings: ReplaySettings,
        default_first_pass_prompt: PromptRecord,
        default_second_pass_prompt: PromptRecord,
    ) -> "ReplaySession":
        events = list(load_pc_events(file_path))
        session = cls(
            session_id=session_id,
            events=events,
            settings=settings,
            file_path=str(file_path),
        )
        session.second_pass_model = (
            settings.second_pass.model if settings.second_pass.enabled else ""
        )
        session.source_language = settings.first_pass.source_language
        session.target_language = settings.first_pass.target_language
        _apply_first_pass_prompt(session, default_first_pass_prompt)
        _apply_second_pass_prompt(session, default_second_pass_prompt)
        session.init_runner()
        return session

    def swap_translator(self):
        """Swap the translator in the existing runner without losing state.
        
        This preserves all internal translation state (target text,
        open chunks, etc.) while switching to the new model.
        """
        if not self.runner:
            return

        if isinstance(self.runner, LiveRunner):
            return

        translator = self.build_translator()
        if self.model is None:
            self.runner.set_translator(translator)
            self.runner.no_translator_mode = True
            self.runner.second_pass_enabled = bool(self.second_pass_model)
            self.runner.second_pass_prompt = self.second_pass_system_prompt
            return

        # Swap translator only - preserve all translation state
        self.runner.set_translator(translator)
        self.runner.no_translator_mode = False
        self.runner.second_pass_enabled = bool(self.second_pass_model)
        self.runner.second_pass_prompt = self.second_pass_system_prompt

def _build_replay_translator(
    *,
    service_model: str | None,
    second_pass_model: str,
    first_pass_prompt: str,
    first_pass_input_template: str,
    second_pass_input_template: str,
    source_language: str,
    target_language: str,
):
    return build_translator(
        "llm-responses",
        dummy_mode="marker",
        service_model=service_model,
        second_pass_model=second_pass_model,
        first_pass_prompt=first_pass_prompt,
        first_pass_input_template=first_pass_input_template,
        second_pass_input_template=second_pass_input_template,
        source_language=source_language,
        target_language=target_language,
    )


async def _playback_loop(session: ReplaySession):
    """Playback loop with configurable speed."""
    session.current_task = asyncio.current_task()
    await _send_state_update(session, "playing")
    if session.policy == "live":
        await _playback_loop_live(session)
        return
    await _playback_loop_replay(session)


async def _playback_loop_replay(session: ReplaySession):
    playback_error: str | None = None
    try:
        while session.status == "playing" and session.current_event_index <= len(session.events):
            event = session.events[session.current_event_index - 1]
            
            # Update source state
            session.update_source(event)
            session.source_revision = session.current_event_index
            
            # Process translation (blocking call) and measure latency
            translation_triggered = False
            translation_wall_ms = 0.0
            decision = None
            if session.runner:
                source_state = session.get_source_state()
                started = time.perf_counter()
                try:
                    decision = session.runner.handle_event(event, source_state)
                except Exception as exc:
                    session.status = "error"
                    playback_error = str(exc)
                    break
                translation_wall_ms = (time.perf_counter() - started) * 1000.0
                if decision.triggered:
                    translation_triggered = True
                    session.target_revision += 1
                    session.target_committed_text = session.runner.target_state.target_committed_text
                    session.target_preview_text = session.runner.target_state.target_preview_text
            
            # Store trace record for metrics export (only if translation happened)
            if decision and decision.triggered:
                _record_translation_trace(
                    session,
                    event_index=session.current_event_index,
                    event_kind=event.kind,
                    event_text=event.text,
                    line_number=event.line_number,
                    decision=decision,
                )
            
            if session.websocket:
                try:
                    await _send_source_update(
                        session,
                        event_index=session.current_event_index,
                        line_number=event.line_number,
                        kind=event.kind,
                        status="playing",
                    )
                    await _send_target_update(
                        session,
                        event_index=session.current_event_index,
                        triggered=translation_triggered,
                        reason=decision.reason if decision else "",
                        wall_ms=translation_wall_ms if translation_triggered else 0.0,
                    )
                    await _send_translation_outcome(
                        session,
                        translated=translation_triggered,
                        event_kind=event.kind,
                        wall_ms=translation_wall_ms if translation_triggered else 0.0,
                        llm_gen_ms=decision.metrics.gpu_generate_total_ms if decision else None,
                        metrics=decision.metrics if decision and translation_triggered else None,
                    )
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
    await _send_state_update(session, final_status, error=playback_error)


async def _playback_loop_live(session: ReplaySession):
    playback_error: str | None = None
    try:
        while session.status == "playing" and session.current_event_index <= len(session.events):
            event = session.events[session.current_event_index - 1]
            session.update_source(event)
            session.source_revision = session.current_event_index

            if isinstance(session.runner, LiveRunner):
                source_state = session.get_source_state()
                try:
                    step = session.runner.on_source_event(event, source_state)
                except Exception as exc:
                    session.status = "error"
                    playback_error = str(exc)
                    break
                if step.dispatch_request is not None:
                    _schedule_live_request(session, step.dispatch_request)

            if session.websocket:
                try:
                    await _send_source_update(
                        session,
                        event_index=session.current_event_index,
                        line_number=event.line_number,
                        kind=event.kind,
                        status="playing",
                    )
                    await _send_target_update(
                        session,
                        event_index=session.current_event_index,
                        triggered=False,
                        reason="",
                        wall_ms=0.0,
                    )
                    if _is_definitive_live_skip_reason(step.reason):
                        await _send_translation_outcome(
                            session,
                            translated=False,
                            event_kind=event.kind,
                        )
                except Exception:
                    session.websocket = None
                    break

            session.current_event_index += 1
            delay_ms = session.get_delay_ms()
            await asyncio.sleep(delay_ms / 1000.0)

    except asyncio.CancelledError:
        pass

    if session.status == "error":
        await _send_state_update(session, "error", error=playback_error)
        return
    if session.status == "completed":
        return
    if session.status != "playing":
        session.status = "paused"
        await _send_state_update(session, "paused")
        return
    if session.current_event_index <= len(session.events):
        session.status = "paused"
        await _send_state_update(session, "paused")
        return
    await _maybe_finish_live_playback(session)


def _sync_target_state(session: ReplaySession) -> None:
    if not session.runner:
        session.target_committed_text = ""
        session.target_preview_text = ""
        return
    session.target_committed_text = session.runner.target_state.target_committed_text
    session.target_preview_text = session.runner.target_state.target_preview_text


def _record_translation_trace(
    session: ReplaySession,
    *,
    event_index: int,
    event_kind: str,
    event_text: str,
    line_number: int,
    decision: TranslationDecision,
    trace_triggered: bool | None = None,
) -> None:
    should_record = decision.triggered if trace_triggered is None else trace_triggered
    if not should_record:
        return
    first_pass_model = decision.first_pass_model or decision.model
    if first_pass_model:
        session.models_used.add(first_pass_model)
    if decision.second_pass_model:
        session.second_pass_models_used.add(decision.second_pass_model)
    metrics = decision.metrics
    session.traces.append(
        TraceRecord(
            event_index=event_index,
            event_kind=event_kind,
            event_text=event_text,
            line_number=line_number,
            triggered=should_record,
            reason=decision.reason,
            source_window=decision.source_window,
            request_id=decision.request_id,
            model=decision.model,
            first_pass_model=first_pass_model,
            second_pass_model=decision.second_pass_model,
            replay_request_wall_ms=metrics.replay_request_wall_ms,
            observed_first_text_ms=metrics.observed_first_text_ms,
            observed_complete_ms=metrics.observed_complete_ms,
            transport_first_byte_ms=metrics.transport_first_byte_ms,
            transport_first_text_delta_ms=metrics.transport_first_text_delta_ms,
            transport_completed_ms=metrics.transport_completed_ms,
            engine_queue_wait_ms=metrics.engine_queue_wait_ms,
            backend_inference_wall_ms=metrics.backend_inference_wall_ms,
            engine_total_wall_ms=metrics.engine_total_wall_ms,
            engine_outside_backend_wall_ms=metrics.engine_outside_backend_wall_ms,
            pool_total_wall_ms=metrics.pool_total_wall_ms,
            engine_tokenize_ms=metrics.engine_tokenize_ms,
            gpu_time_to_first_token_ms=metrics.gpu_time_to_first_token_ms,
            gpu_generate_total_ms=metrics.gpu_generate_total_ms,
            gpu_decode_after_first_token_ms=metrics.gpu_decode_after_first_token_ms,
            engine_tokens_per_second=metrics.engine_tokens_per_second,
        )
    )


def _is_definitive_live_skip_reason(reason: str) -> bool:
    return reason in {
        "unsupported_event_kind",
        "empty_committed_window",
        "empty_preview",
        "preview_translation_disabled",
        "preview_needs_previous_sample",
        "preview_below_min_chars",
        "preview_unstable",
        "preview_not_grown_enough",
        "empty_preview_window",
    }


async def _cancel_live_request_task(session: ReplaySession) -> None:
    if not session.live_request_task:
        return
    session.live_request_task.cancel()
    try:
        await session.live_request_task
    except asyncio.CancelledError:
        pass
    session.live_request_task = None


def _schedule_live_request(session: ReplaySession, request: LiveDispatchRequest) -> None:
    translator = session.build_translator()
    session.live_request_task = asyncio.create_task(
        _run_live_request_task(
            session,
            request,
            translator=translator,
            no_translator_mode=session.model is None,
            second_pass_enabled=bool(session.second_pass_model),
            second_pass_prompt=session.second_pass_system_prompt,
        )
    )


async def _run_live_request_task(
    session: ReplaySession,
    request: LiveDispatchRequest,
    *,
    translator,
    no_translator_mode: bool,
    second_pass_enabled: bool,
    second_pass_prompt: str | None,
) -> None:
    try:
        decision, translated_text = await asyncio.to_thread(
            execute_live_dispatch_request,
            request=request,
            translator=translator,
            no_translator_mode=no_translator_mode,
            second_pass_enabled=second_pass_enabled,
            second_pass_prompt=second_pass_prompt,
        )
    except asyncio.CancelledError:
        return
    except Exception as exc:
        session.live_request_task = None
        session.status = "error"
        await _send_state_update(session, "error", error=str(exc))
        return

    if not isinstance(session.runner, LiveRunner):
        session.live_request_task = None
        return

    session.live_request_task = None
    step = session.runner.on_llm_result(request, translated_text)
    if step.result_applied:
        session.target_revision += 1
    _sync_target_state(session)
    _record_translation_trace(
        session,
        event_index=max(0, min(session.current_event_index - 1, len(session.events))),
        event_kind="p" if request.opportunity.lane == "preview" else "c",
        event_text=request.opportunity.source_window,
        line_number=0,
        decision=decision,
        trace_triggered=True,
    )
    await _send_target_update(
        session,
        event_index=max(0, min(session.current_event_index - 1, len(session.events))),
        triggered=step.result_applied,
        reason=step.reason,
        wall_ms=decision.metrics.replay_request_wall_ms or 0.0,
    )
    await _send_translation_outcome(
        session,
        translated=step.result_applied,
        event_kind="p" if request.opportunity.lane == "preview" else "c",
        wall_ms=decision.metrics.replay_request_wall_ms or 0.0,
        llm_gen_ms=decision.metrics.gpu_generate_total_ms,
        metrics=decision.metrics,
    )
    if step.dispatch_request is not None:
        _schedule_live_request(session, step.dispatch_request)
        return
    await _maybe_finish_live_playback(session)


async def _maybe_finish_live_playback(session: ReplaySession) -> None:
    if not isinstance(session.runner, LiveRunner):
        return
    if session.status != "playing":
        return
    if session.current_event_index <= len(session.events):
        return
    if session.live_request_task is not None:
        return
    session.status = "completed"
    await _send_state_update(session, "completed")
