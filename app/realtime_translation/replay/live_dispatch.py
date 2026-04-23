from __future__ import annotations

import time
from dataclasses import replace

from realtime_translation_engine import LiveDispatchRequest
from realtime_translation_engine import TranslationDecision
from realtime_translation_engine import TranslationMetrics


def execute_live_dispatch_request(
    *,
    request: LiveDispatchRequest,
    translator,
    no_translator_mode: bool,
    second_pass_enabled: bool,
    second_pass_prompt: str | None,
) -> tuple[TranslationDecision, str]:
    opportunity = request.opportunity

    if no_translator_mode:
        request_id = ""
        second_pass_model = ""
        metrics = TranslationMetrics()
        output_text = opportunity.source_window
        if opportunity.lane == "preview":
            reason = "preview_event_passthrough"
        elif not opportunity.commits_target:
            reason = "committed_event_passthrough_preview"
        elif second_pass_enabled:
            started = time.perf_counter()
            second_pass_result = translator.run_second_pass(
                opportunity.source_window,
                opportunity.source_window,
                system_prompt=second_pass_prompt,
            )
            output_text = second_pass_result.text
            request_id = second_pass_result.request_id
            second_pass_model = second_pass_result.model
            replay_request_wall_ms = (time.perf_counter() - started) * 1000.0
            metrics = replace(
                second_pass_result.metrics,
                replay_request_wall_ms=replay_request_wall_ms,
                observed_first_text_ms=replay_request_wall_ms,
                observed_complete_ms=replay_request_wall_ms,
            )
            reason = "committed_event_passthrough_second_pass"
        else:
            reason = "committed_event_passthrough"
        return (
            TranslationDecision(
                triggered=True,
                reason=reason,
                source_window=opportunity.source_window,
                source_chunks_used=opportunity.source_chunks_used,
                request_id=request_id,
                second_pass_model=second_pass_model,
                metrics=metrics,
            ),
            output_text,
        )

    started = time.perf_counter()
    translation = translator.translate(opportunity.source_window)
    first_pass_model = translation.model
    final_translation = translation
    second_pass_model = ""
    if opportunity.lane == "commit" and opportunity.commits_target and second_pass_enabled:
        final_translation = translator.run_second_pass(
            opportunity.source_window,
            translation.text,
            system_prompt=second_pass_prompt,
        )
        second_pass_model = final_translation.model
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
            second_pass_model=second_pass_model,
            metrics=metrics,
        ),
        final_translation.text,
    )
