from __future__ import annotations

from types import SimpleNamespace
import unittest

from app.realtime_translation.replay.live_dispatch import execute_live_dispatch_request
from realtime_translation_engine import TranslationMetrics
from realtime_translation_engine import TranslationResult


class _FakeTranslator:
    def translate(self, source_window: str) -> TranslationResult:
        self.last_source_window = source_window
        return TranslationResult(
            text="draft translation",
            request_id="req_first",
            model="first-model",
            metrics=TranslationMetrics(
                transport_first_byte_ms=10.0,
                transport_first_text_delta_ms=12.0,
                transport_completed_ms=100.0,
                engine_queue_wait_ms=5.0,
                backend_inference_wall_ms=60.0,
                engine_total_wall_ms=70.0,
                engine_outside_backend_wall_ms=10.0,
                pool_total_wall_ms=74.0,
                engine_tokenize_ms=1.0,
                gpu_time_to_first_token_ms=14.0,
                gpu_generate_total_ms=40.0,
                gpu_decode_after_first_token_ms=26.0,
                engine_prompt_tokens=30,
                engine_output_tokens=10,
                engine_tokens_per_second=250.0,
            ),
        )

    def run_second_pass(
        self,
        source_window: str,
        draft_translation: str,
        *,
        system_prompt: str | None = None,
    ) -> TranslationResult:
        self.last_second_pass = (source_window, draft_translation, system_prompt)
        return TranslationResult(
            text="final translation",
            request_id="req_second",
            model="second-model",
            metrics=TranslationMetrics(
                transport_first_byte_ms=16.0,
                transport_first_text_delta_ms=18.0,
                transport_completed_ms=120.0,
                engine_queue_wait_ms=7.0,
                backend_inference_wall_ms=80.0,
                engine_total_wall_ms=95.0,
                engine_outside_backend_wall_ms=15.0,
                pool_total_wall_ms=101.0,
                engine_tokenize_ms=2.0,
                gpu_time_to_first_token_ms=16.0,
                gpu_generate_total_ms=50.0,
                gpu_decode_after_first_token_ms=34.0,
                engine_prompt_tokens=20,
                engine_output_tokens=12,
                engine_tokens_per_second=240.0,
            ),
        )


class ReplayLiveDispatchTests(unittest.TestCase):
    def test_second_pass_combines_additive_metrics_for_single_replay_decision(self) -> None:
        request = SimpleNamespace(
            opportunity=SimpleNamespace(
                source_window="source text",
                lane="commit",
                commits_target=True,
                source_chunks_used=3,
            )
        )
        translator = _FakeTranslator()

        decision, output_text = execute_live_dispatch_request(
            request=request,
            translator=translator,
            no_translator_mode=False,
            second_pass_enabled=True,
            second_pass_prompt="revise",
        )

        self.assertEqual(output_text, "final translation")
        self.assertEqual(decision.first_pass_model, "first-model")
        self.assertEqual(decision.second_pass_model, "second-model")
        self.assertEqual(decision.request_id, "req_second")
        self.assertEqual(translator.last_second_pass, ("source text", "draft translation", "revise"))
        self.assertGreater(decision.metrics.replay_request_wall_ms or 0.0, 0.0)
        self.assertEqual(decision.metrics.transport_first_byte_ms, 10.0)
        self.assertEqual(decision.metrics.transport_first_text_delta_ms, 12.0)
        self.assertEqual(decision.metrics.transport_completed_ms, 220.0)
        self.assertEqual(decision.metrics.engine_queue_wait_ms, 12.0)
        self.assertEqual(decision.metrics.backend_inference_wall_ms, 140.0)
        self.assertEqual(decision.metrics.engine_total_wall_ms, 165.0)
        self.assertEqual(decision.metrics.engine_outside_backend_wall_ms, 25.0)
        self.assertEqual(decision.metrics.pool_total_wall_ms, 175.0)
        self.assertEqual(decision.metrics.engine_tokenize_ms, 3.0)
        self.assertEqual(decision.metrics.gpu_time_to_first_token_ms, 30.0)
        self.assertEqual(decision.metrics.gpu_generate_total_ms, 90.0)
        self.assertEqual(decision.metrics.gpu_decode_after_first_token_ms, 60.0)
        self.assertEqual(decision.metrics.engine_prompt_tokens, 50)
        self.assertEqual(decision.metrics.engine_output_tokens, 22)
        self.assertAlmostEqual(decision.metrics.engine_tokens_per_second or 0.0, 22 / 0.09, places=4)


if __name__ == "__main__":
    unittest.main()
