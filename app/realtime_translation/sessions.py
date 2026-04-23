from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field, replace
from typing import Dict, Optional
from pathlib import Path


from app.realtime_translation.events import load_pc_events
from realtime_translation_engine import LiveDispatchRequest
from realtime_translation_engine import LiveRunner
from realtime_translation_engine import SourceEvent
from realtime_translation_engine import SourceTranscriptState
from promptlib import FilePromptLibraryStore, PromptNotFoundError, PromptRecord
from realtime_translation_engine import ReplayRunner
from realtime_translation_engine import TranslationMetrics
from realtime_translation_engine import TranslationCore
from realtime_translation_engine import TranslationDecision
from realtime_translation_engine.translators import build_translator
from app.realtime_translation.settings import load_replay_settings

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
    events: list[SourceEvent]
    file_path: str = ""  # Path to the .pc file
    current_event_index: int = 1
    source_revision: int = 0
    target_revision: int = 0
    status: str = "idle"
    speed: str = "normal"
    policy: str = "replay"
    model: Optional[str] = None  # Selected model for translations
    correction_model: str = ""  # Empty string means correction is off
    first_pass_prompt_id: str = DEFAULT_FIRST_PASS_PROMPT_ID
    first_pass_system_prompt: str = ""
    first_pass_user_prompt: str = "{{source_window}}"
    second_pass_prompt_id: str = DEFAULT_SECOND_PASS_PROMPT_ID
    second_pass_system_prompt: str = ""
    second_pass_user_prompt: str = "{{draft_translation}}"
    source_language: str = "English"
    target_language: str = "Dutch"
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
    
    # Track all models used during session (for export accuracy)
    models_used: set[str] = field(default_factory=set)
    correction_models_used: set[str] = field(default_factory=set)
    
    def build_translator(self):
        settings = load_replay_settings()
        service_model = self.model if self.model is not None else settings.first_pass.default_model
        return _build_replay_translator(
            service_model=service_model,
            correction_model=self.correction_model,
            first_pass_prompt=self.first_pass_system_prompt,
            first_pass_input_template=self.first_pass_user_prompt,
            second_pass_input_template=self.second_pass_user_prompt,
            source_language=self.source_language,
            target_language=self.target_language,
        )

    def init_runner(self):
        """Initialize runner for the selected policy."""
        settings = load_replay_settings()
        core = TranslationCore(preview_settings=settings.preview_translation)
        if self.policy == "live":
            self.runner = LiveRunner(core=core)
            return
        self.runner = ReplayRunner(
            translator=self.build_translator(),
            core=core,
            commit_correction_enabled=bool(self.correction_model),
            commit_correction_prompt=self.second_pass_system_prompt,
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
        settings,
        default_first_pass_prompt: PromptRecord,
        default_second_pass_prompt: PromptRecord,
    ) -> "ReplaySession":
        events = list(load_pc_events(file_path))
        session = cls(
            session_id=session_id,
            events=events,
            file_path=str(file_path),
        )
        session.correction_model = (
            settings.commit_correction.model if settings.commit_correction.enabled else ""
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
            self.runner.commit_correction_enabled = bool(self.correction_model)
            self.runner.commit_correction_prompt = self.second_pass_system_prompt
            return

        # Swap translator only - preserve all translation state
        self.runner.set_translator(translator)
        self.runner.no_translator_mode = False
        self.runner.commit_correction_enabled = bool(self.correction_model)
        self.runner.commit_correction_prompt = self.second_pass_system_prompt


def _is_translation_stage_prompt(record: PromptRecord, stage_name: str) -> bool:
    translation_section = record.sections.get("translation", {})
    if not isinstance(translation_section, dict):
        return False
    stage = str(translation_section.get("stage", "")).strip().lower()
    return stage == str(stage_name or "").strip().lower()


def _is_first_pass_prompt(record: PromptRecord) -> bool:
    return _is_translation_stage_prompt(record, "first_pass")


def _is_second_pass_prompt(record: PromptRecord) -> bool:
    return _is_translation_stage_prompt(record, "second_pass")


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


def _load_second_pass_prompt(prompt_id: str) -> PromptRecord:
    _prompt_store.reload()
    try:
        record = _prompt_store.get_prompt(prompt_id)
    except PromptNotFoundError as exc:
        raise ValueError(str(exc)) from exc
    if not record.enabled:
        raise ValueError(f"Prompt {prompt_id!r} is disabled.")
    if not _is_second_pass_prompt(record):
        raise ValueError(f"Prompt {prompt_id!r} is not a second-pass translation prompt.")
    return record


def _apply_first_pass_prompt(session: ReplaySession, prompt: PromptRecord) -> None:
    session.first_pass_prompt_id = prompt.id
    session.first_pass_system_prompt = prompt.system_prompt
    session.first_pass_user_prompt = prompt.prompt_text


def _apply_second_pass_prompt(session: ReplaySession, prompt: PromptRecord) -> None:
    session.second_pass_prompt_id = prompt.id
    session.second_pass_system_prompt = prompt.system_prompt
    session.second_pass_user_prompt = prompt.prompt_text


def _build_replay_translator(
    *,
    service_model: str | None,
    correction_model: str,
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
        correction_model=correction_model,
        first_pass_prompt=first_pass_prompt,
        first_pass_input_template=first_pass_input_template,
        correction_input_template=second_pass_input_template,
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
                        wall_ms=translation_wall_ms if translation_triggered else 0.0,
                        llm_gen_ms=decision.metrics.gpu_generate_total_ms if decision else None,
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
    if decision.correction_model:
        session.correction_models_used.add(decision.correction_model)
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
    )


async def _send_state_update(session: ReplaySession, status: str, *, error: str | None = None) -> None:
    if not session.websocket:
        return
    try:
        payload = {
            "status": status,
            "event_index": min(session.current_event_index, len(session.events)),
        }
        if error:
            payload["error"] = error
        await session.websocket.send_json({
            "type": "state_update",
            "data": payload,
        })
    except Exception:
        session.websocket = None


def _build_committed_delta(
    current_committed_text: str,
    last_sent_committed_text: str,
    *,
    force_reset: bool,
) -> tuple[bool, str]:
    if force_reset or not current_committed_text.startswith(last_sent_committed_text):
        return True, current_committed_text
    return False, current_committed_text[len(last_sent_committed_text):]


async def _send_source_update(
    session: ReplaySession,
    *,
    event_index: int,
    line_number: int,
    kind: str,
    status: str,
    force_reset: bool = False,
) -> None:
    if not session.websocket:
        return
    reset, committed_append = _build_committed_delta(
        session.source_committed_text,
        session.last_sent_source_committed_text,
        force_reset=force_reset,
    )
    try:
        await session.websocket.send_json({
            "type": "source_update",
            "data": {
                "reset": reset,
                "committed_append": committed_append,
                "preview": session.source_preview_text,
                "event_index": event_index,
                "source_revision": session.source_revision,
                "line_number": line_number,
                "kind": kind,
                "model": session.get_model_display(),
                "status": status,
            },
        })
        session.last_sent_source_committed_text = session.source_committed_text
    except Exception:
        session.websocket = None


async def _send_target_update(
    session: ReplaySession,
    *,
    event_index: int,
    triggered: bool,
    reason: str,
    wall_ms: float,
    force_reset: bool = False,
) -> None:
    if not session.websocket:
        return
    reset, committed_append = _build_committed_delta(
        session.target_committed_text,
        session.last_sent_target_committed_text,
        force_reset=force_reset,
    )
    try:
        await session.websocket.send_json({
            "type": "target_update",
            "data": {
                "reset": reset,
                "committed_append": committed_append,
                "preview": session.target_preview_text,
                "event_index": event_index,
                "target_revision": session.target_revision,
                "triggered": triggered,
                "reason": reason,
                "wall_ms": round(wall_ms, 1) if triggered else 0.0,
            }
        })
        session.last_sent_target_committed_text = session.target_committed_text
    except Exception:
        session.websocket = None


async def _send_translation_outcome(
    session: ReplaySession,
    *,
    translated: bool,
    wall_ms: float = 0.0,
    llm_gen_ms: float | None = None,
) -> None:
    if not session.websocket:
        return
    try:
        await session.websocket.send_json({
            "type": "translation_outcome",
            "data": {
                "translated": translated,
                "wall_ms": round(wall_ms, 1) if translated else 0.0,
                "llm_gen_ms": round(llm_gen_ms, 1) if translated and llm_gen_ms is not None else None,
            },
        })
    except Exception:
        session.websocket = None


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
            commit_correction_enabled=bool(session.correction_model),
            commit_correction_prompt=session.second_pass_system_prompt,
        )
    )


async def _run_live_request_task(
    session: ReplaySession,
    request: LiveDispatchRequest,
    *,
    translator,
    no_translator_mode: bool,
    commit_correction_enabled: bool,
    commit_correction_prompt: str | None,
) -> None:
    try:
        decision, translated_text = await asyncio.to_thread(
            _execute_live_dispatch_request,
            request=request,
            translator=translator,
            no_translator_mode=no_translator_mode,
            commit_correction_enabled=commit_correction_enabled,
            commit_correction_prompt=commit_correction_prompt,
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
        wall_ms=decision.metrics.replay_request_wall_ms or 0.0,
        llm_gen_ms=decision.metrics.gpu_generate_total_ms,
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


def _execute_live_dispatch_request(
    *,
    request: LiveDispatchRequest,
    translator,
    no_translator_mode: bool,
    commit_correction_enabled: bool,
    commit_correction_prompt: str | None,
) -> tuple[TranslationDecision, str]:
    opportunity = request.opportunity

    if no_translator_mode:
        request_id = ""
        correction_model = ""
        metrics = TranslationMetrics()
        output_text = opportunity.source_window
        if opportunity.lane == "preview":
            reason = "preview_event_passthrough"
        elif not opportunity.commits_target:
            reason = "committed_event_passthrough_preview"
        elif commit_correction_enabled:
            started = time.perf_counter()
            revised = translator.revise_translation(
                opportunity.source_window,
                opportunity.source_window,
                system_prompt=commit_correction_prompt,
            )
            output_text = revised.text
            request_id = revised.request_id
            correction_model = revised.model
            replay_request_wall_ms = (time.perf_counter() - started) * 1000.0
            metrics = replace(
                revised.metrics,
                replay_request_wall_ms=replay_request_wall_ms,
                observed_first_text_ms=replay_request_wall_ms,
                observed_complete_ms=replay_request_wall_ms,
            )
            reason = "committed_event_passthrough_revised"
        else:
            reason = "committed_event_passthrough"
        return (
            TranslationDecision(
                triggered=True,
                reason=reason,
                source_window=opportunity.source_window,
                source_chunks_used=opportunity.source_chunks_used,
                request_id=request_id,
                correction_model=correction_model,
                metrics=metrics,
            ),
            output_text,
        )

    started = time.perf_counter()
    translation = translator.translate(opportunity.source_window)
    first_pass_model = translation.model
    final_translation = translation
    correction_model = ""
    if opportunity.lane == "commit" and opportunity.commits_target and commit_correction_enabled:
        final_translation = translator.revise_translation(
            opportunity.source_window,
            translation.text,
            system_prompt=commit_correction_prompt,
        )
        correction_model = final_translation.model
    replay_request_wall_ms = (time.perf_counter() - started) * 1000.0
    metrics = replace(
        final_translation.metrics,
        replay_request_wall_ms=replay_request_wall_ms,
        observed_first_text_ms=replay_request_wall_ms,
        observed_complete_ms=replay_request_wall_ms,
    )
    return (
        TranslationDecision(
            triggered=True,
            reason=(
                "preview_event_translated"
                if opportunity.lane == "preview"
                else "committed_event_translated"
            ),
            source_window=opportunity.source_window,
            source_chunks_used=opportunity.source_chunks_used,
            request_id=final_translation.request_id,
            model=final_translation.model,
            first_pass_model=first_pass_model,
            correction_model=correction_model,
            metrics=metrics,
        ),
        final_translation.text,
    )


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
