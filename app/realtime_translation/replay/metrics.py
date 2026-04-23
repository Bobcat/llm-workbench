from __future__ import annotations

from typing import TYPE_CHECKING

from app.realtime_translation.replay.settings import load_replay_settings

if TYPE_CHECKING:
    from app.realtime_translation.replay.sessions import ReplaySession
    from app.realtime_translation.replay.sessions import TraceRecord


def _metric_values(traces: list[TraceRecord], name: str) -> list[float]:
    values: list[float] = []
    for trace in traces:
        value = getattr(trace, name)
        if value is not None:
            values.append(float(value))
    return values


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def _summarize_metric(values: list[float]) -> dict[str, float | int] | None:
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
    translated_traces = [trace for trace in traces if trace.triggered]
    preview_translations = sum(1 for trace in translated_traces if trace.event_kind == "p")
    commit_translations = sum(1 for trace in translated_traces if trace.event_kind == "c")
    settings = load_replay_settings()
    default_first_pass_model = settings.first_pass.default_model
    configured_second_pass_model = session.second_pass_model

    if len(session.models_used) > 1:
        model_display = "<mixed models>"
    elif len(session.models_used) == 1:
        model_display = next(iter(session.models_used))
    else:
        model_display = session.model or default_first_pass_model

    if len(session.second_pass_models_used) > 1:
        second_pass_model_display = "<mixed second-pass models>"
    elif len(session.second_pass_models_used) == 1:
        second_pass_model_display = next(iter(session.second_pass_models_used))
    else:
        second_pass_model_display = configured_second_pass_model

    return {
        "sample_file": session.file_path,
        "model": model_display,
        "second_pass_model": second_pass_model_display,
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
    metrics_payload = metrics_summary.get("metrics", {})
    if not isinstance(metrics_payload, dict):
        metrics_payload = {}

    lines = [
        f"Sample file: {metrics_summary.get('sample_file', '')}",
        f"Model: {metrics_summary.get('model', '') or '(default)'}",
        f"Second-pass model: {metrics_summary.get('second_pass_model', '') or '(none)'}",
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
