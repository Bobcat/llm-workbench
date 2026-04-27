from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.realtime_translation.replay.sessions import ReplaySession
    from realtime_translation_engine import TranslationMetrics


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
    event_kind: str = "",
    wall_ms: float = 0.0,
    llm_gen_ms: float | None = None,
    metrics: TranslationMetrics | None = None,
) -> None:
    if not session.websocket:
        return
    payload = {
        "translated": translated,
        "request_executed": metrics is not None,
        "event_kind": event_kind,
        "wall_ms": round(wall_ms, 1) if translated else 0.0,
        "llm_gen_ms": round(llm_gen_ms, 1) if translated and llm_gen_ms is not None else None,
    }
    if metrics is not None:
        for key in (
            "replay_request_wall_ms",
            "transport_first_byte_ms",
            "transport_first_text_delta_ms",
            "transport_completed_ms",
            "engine_queue_wait_ms",
            "backend_inference_wall_ms",
            "engine_total_wall_ms",
            "engine_outside_backend_wall_ms",
            "pool_total_wall_ms",
            "engine_tokenize_ms",
            "gpu_time_to_first_token_ms",
            "gpu_generate_total_ms",
            "gpu_decode_after_first_token_ms",
        ):
            value = getattr(metrics, key)
            payload[key] = round(float(value), 1) if value is not None else None
    try:
        await session.websocket.send_json({
            "type": "translation_outcome",
            "data": payload,
        })
    except Exception:
        session.websocket = None
