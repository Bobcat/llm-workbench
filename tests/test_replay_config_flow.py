from __future__ import annotations

import asyncio
import importlib
import sys
from types import SimpleNamespace
import types
import unittest
from unittest.mock import Mock

from app.realtime_translation.replay.events import SourceEventTiming
from app.realtime_translation.replay.metrics import _build_metrics_summary
from app.realtime_translation.replay.sessions import ReplaySession
from realtime_translation_engine import SourceEvent


class ReplayConfigFlowTests(unittest.TestCase):
    def test_fixed_delay_speed_keeps_existing_delay(self) -> None:
        session = ReplaySession(
            session_id="session-1",
            events=[SourceEvent(kind="p", text="preview", line_number=2)],
            event_timings=[SourceEventTiming(speech_start_ms=0, speech_end_ms=335)],
            settings=SimpleNamespace(),
            speed="normal",
        )

        self.assertEqual(session.get_delay_ms(event_index=1), 500)
        self.assertEqual(session.source_timing_payload(1)["clock"], "fixed_delay")

    def test_recorded_speed_uses_next_event_timestamp_gap(self) -> None:
        session = ReplaySession(
            session_id="session-1",
            events=[
                SourceEvent(kind="p", text="one", line_number=2),
                SourceEvent(kind="p", text="two", line_number=3),
                SourceEvent(kind="c", text="three", line_number=4),
            ],
            event_timings=[
                SourceEventTiming(speech_start_ms=0, speech_end_ms=335),
                SourceEventTiming(speech_start_ms=0, speech_end_ms=655),
                SourceEventTiming(speech_start_ms=0, speech_end_ms=1000),
            ],
            settings=SimpleNamespace(),
            speed="recorded_2x",
        )

        self.assertEqual(session.get_delay_ms(event_index=1), 160)
        self.assertEqual(session.get_delay_ms(event_index=2), 172)
        self.assertEqual(session.get_delay_ms(event_index=3), 0)
        self.assertEqual(session.source_timing_payload(1)["clock"], "recorded_2x")
        self.assertEqual(session.source_timing_payload(1)["clock_label"], "recorded 2x")

    def test_recorded_event_due_delay_subtracts_elapsed_wall_time(self) -> None:
        session = ReplaySession(
            session_id="session-1",
            events=[
                SourceEvent(kind="p", text="one", line_number=2),
                SourceEvent(kind="p", text="two", line_number=3),
            ],
            event_timings=[
                SourceEventTiming(speech_start_ms=0, speech_end_ms=335),
                SourceEventTiming(speech_start_ms=0, speech_end_ms=655),
            ],
            settings=SimpleNamespace(),
            speed="recorded_1x",
        )

        self.assertEqual(
            session.get_event_due_delay_ms(
                event_index=1,
                playback_started_at=100.0,
                now=100.050,
            ),
            285,
        )
        self.assertEqual(
            session.get_event_due_delay_ms(
                event_index=2,
                playback_started_at=100.0,
                now=100.500,
            ),
            155,
        )
        self.assertEqual(
            session.get_event_due_delay_ms(
                event_index=2,
                playback_started_at=100.0,
                now=100.800,
            ),
            0,
        )

    def test_recorded_event_due_delay_honors_speed_multiplier(self) -> None:
        session = ReplaySession(
            session_id="session-1",
            events=[SourceEvent(kind="p", text="one", line_number=2)],
            event_timings=[SourceEventTiming(speech_start_ms=0, speech_end_ms=1000)],
            settings=SimpleNamespace(),
            speed="recorded_2x",
        )

        self.assertEqual(
            session.get_event_due_delay_ms(
                event_index=1,
                playback_started_at=200.0,
                now=200.100,
            ),
            400,
        )

    def test_recorded_max_has_no_delay(self) -> None:
        session = ReplaySession(
            session_id="session-1",
            events=[
                SourceEvent(kind="p", text="one", line_number=2),
                SourceEvent(kind="p", text="two", line_number=3),
            ],
            event_timings=[
                SourceEventTiming(speech_start_ms=0, speech_end_ms=335),
                SourceEventTiming(speech_start_ms=0, speech_end_ms=655),
            ],
            settings=SimpleNamespace(),
            speed="recorded_max",
        )

        self.assertEqual(session.get_delay_ms(event_index=1), 0)
        self.assertEqual(session.source_timing_payload(1)["clock"], "recorded_max")

    def test_metrics_summary_uses_session_settings_default_model(self) -> None:
        session = SimpleNamespace(
            settings=SimpleNamespace(
                first_pass=SimpleNamespace(default_model="session-default-model"),
            ),
            model=None,
            second_pass_model="",
            models_used=set(),
            second_pass_models_used=set(),
            file_path="sample.pc",
            events=[],
        )

        metrics_summary = _build_metrics_summary(session=session, traces=[])

        self.assertEqual(metrics_summary["model"], "session-default-model")

    def test_export_runtime_uses_session_settings_default_model(self) -> None:
        module_name = "app.realtime_translation.replay.export_runtime"
        llm_pool_module_name = "app.llm_pool.models"
        previous_export_module = sys.modules.pop(module_name, None)
        previous_llm_pool_module = sys.modules.get(llm_pool_module_name)

        llm_pool_module = types.ModuleType(llm_pool_module_name)
        llm_pool_module._request_json = Mock(
            return_value={
                "models": [
                    {
                        "name": "session-default-model",
                        "resolved_backend": "llama_cpp",
                        "definition": {
                            "gguf_n_ctx": 8192,
                            "gguf_flash_attn": "auto",
                            "gguf_type_k": None,
                            "gguf_type_v": None,
                        },
                        "load_override": {},
                        "load_constraints": {},
                    }
                ]
            }
        )
        sys.modules[llm_pool_module_name] = llm_pool_module

        try:
            export_runtime = importlib.import_module(module_name)
            session = SimpleNamespace(
                settings=SimpleNamespace(
                    first_pass=SimpleNamespace(default_model="session-default-model"),
                ),
                model=None,
                models_used=set(),
                second_pass_models_used=set(),
                second_pass_model="",
            )

            lines = asyncio.run(export_runtime._build_export_runtime_settings_lines(session))

            self.assertIn("Model backend: llama_cpp", lines)
            self.assertIn("Model context size: 8192", lines)
            llm_pool_module._request_json.assert_called_once_with(
                method="GET",
                path="/v1/admin/models",
                timeout=3.0,
            )
        finally:
            sys.modules.pop(module_name, None)
            if previous_export_module is not None:
                sys.modules[module_name] = previous_export_module
            if previous_llm_pool_module is not None:
                sys.modules[llm_pool_module_name] = previous_llm_pool_module
            else:
                sys.modules.pop(llm_pool_module_name, None)


if __name__ == "__main__":
    unittest.main()
