from __future__ import annotations

import time
from dataclasses import replace

from realtime_translation_engine import LiveDispatchRequest
from realtime_translation_engine import TranslationDecision
from realtime_translation_engine import TranslationMetrics


def _sum_optional_float(*values: float | None) -> float | None:
    present = [float(value) for value in values if value is not None]
    if not present:
        return None
    return sum(present)


def _sum_optional_int(*values: int | None) -> int | None:
    present = [int(value) for value in values if value is not None]
    if not present:
        return None
    return sum(present)


def _prefer_first_non_none(*values):
    for value in values:
        if value is not None:
            return value
    return None


def _combine_translation_metrics(
    first_metrics: TranslationMetrics,
    second_metrics: TranslationMetrics,
) -> TranslationMetrics:
    total_generate_ms = _sum_optional_float(
        first_metrics.gpu_generate_total_ms,
        second_metrics.gpu_generate_total_ms,
    )
    total_output_tokens = _sum_optional_int(
        first_metrics.engine_output_tokens,
        second_metrics.engine_output_tokens,
    )
    combined_tokens_per_second: float | None = None
    if total_output_tokens is not None and total_generate_ms is not None and total_generate_ms > 0.0:
        combined_tokens_per_second = total_output_tokens / (total_generate_ms / 1000.0)
    else:
        combined_tokens_per_second = _prefer_first_non_none(
            second_metrics.engine_tokens_per_second,
            first_metrics.engine_tokens_per_second,
        )
    return replace(
        second_metrics,
        transport_first_byte_ms=_prefer_first_non_none(
            first_metrics.transport_first_byte_ms,
            second_metrics.transport_first_byte_ms,
        ),
        transport_first_text_delta_ms=_prefer_first_non_none(
            first_metrics.transport_first_text_delta_ms,
            second_metrics.transport_first_text_delta_ms,
        ),
        transport_completed_ms=_sum_optional_float(
            first_metrics.transport_completed_ms,
            second_metrics.transport_completed_ms,
        ),
        engine_queue_wait_ms=_sum_optional_float(
            first_metrics.engine_queue_wait_ms,
            second_metrics.engine_queue_wait_ms,
        ),
        backend_inference_wall_ms=_sum_optional_float(
            first_metrics.backend_inference_wall_ms,
            second_metrics.backend_inference_wall_ms,
        ),
        engine_total_wall_ms=_sum_optional_float(
            first_metrics.engine_total_wall_ms,
            second_metrics.engine_total_wall_ms,
        ),
        engine_outside_backend_wall_ms=_sum_optional_float(
            first_metrics.engine_outside_backend_wall_ms,
            second_metrics.engine_outside_backend_wall_ms,
        ),
        pool_total_wall_ms=_sum_optional_float(
            first_metrics.pool_total_wall_ms,
            second_metrics.pool_total_wall_ms,
        ),
        engine_tokenize_ms=_sum_optional_float(
            first_metrics.engine_tokenize_ms,
            second_metrics.engine_tokenize_ms,
        ),
        gpu_time_to_first_token_ms=_sum_optional_float(
            first_metrics.gpu_time_to_first_token_ms,
            second_metrics.gpu_time_to_first_token_ms,
        ),
        gpu_generate_total_ms=total_generate_ms,
        gpu_decode_after_first_token_ms=_sum_optional_float(
            first_metrics.gpu_decode_after_first_token_ms,
            second_metrics.gpu_decode_after_first_token_ms,
        ),
        engine_prompt_tokens=_sum_optional_int(
            first_metrics.engine_prompt_tokens,
            second_metrics.engine_prompt_tokens,
        ),
        engine_output_tokens=total_output_tokens,
        engine_tokens_per_second=combined_tokens_per_second,
    )


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
        second_pass_translation = translator.run_second_pass(
            opportunity.source_window,
            translation.text,
            system_prompt=second_pass_prompt,
        )
        final_translation = replace(
            second_pass_translation,
            metrics=_combine_translation_metrics(
                translation.metrics,
                second_pass_translation.metrics,
            ),
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
