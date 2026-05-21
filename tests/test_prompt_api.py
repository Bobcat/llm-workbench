from __future__ import annotations

import json
import unittest
from unittest import mock

from app.prompt_testing import ad_hoc
from app.realtime_translation.prompt_library.prompts import _render_translation_prompt_template


class PromptApiTemplateRenderTests(unittest.TestCase):
    def test_render_translation_prompt_template_replaces_draft_translation(self) -> None:
        rendered = _render_translation_prompt_template(
            "SRC={{source_window}} DRAFT={{draft_translation}} {{source_lang}}>{{target_lang}}",
            source_text="Hello world",
            draft_translation="Hallo wereld",
            source_language="English",
            target_language="Dutch",
        )

        self.assertEqual(
            rendered,
            "SRC=Hello world DRAFT=Hallo wereld English>Dutch",
        )


class PromptRunnerApiTests(unittest.TestCase):
    def test_prompt_runner_payload_includes_explicit_remote_gate(self) -> None:
        payload = ad_hoc._prompt_runner_payload(
            model="kimi-k2.6",
            system_prompt="Translate.",
            rendered_user_prompt="Hallo",
            allow_remote=True,
        )

        self.assertEqual(payload["model"], "kimi-k2.6")
        self.assertTrue(payload["allow_remote"])
        self.assertEqual(payload["decoding"]["temperature"], 0.6)
        self.assertEqual(payload["decoding"]["top_p"], 0.95)
        self.assertNotIn("top_k", payload["decoding"])

    def test_prompt_runner_uses_llm_pool_base_url(self) -> None:
        captured: dict[str, str] = {}

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback) -> None:
                return None

            def read(self) -> bytes:
                return json.dumps({"output_text": "", "metrics": {}}).encode("utf-8")

        def fake_urlopen(req, timeout: float):
            captured["url"] = req.full_url
            captured["timeout"] = str(timeout)
            return FakeResponse()

        with (
            mock.patch.object(ad_hoc, "_llm_pool_base_url", return_value="http://pool:8012"),
            mock.patch.object(ad_hoc.urllib_request, "urlopen", side_effect=fake_urlopen),
        ):
            ad_hoc._run_prompt_runner_payload({"model": "kimi-k2.6"})

        self.assertEqual(captured["url"], "http://pool:8012/v1/responses")
        self.assertEqual(captured["timeout"], "120.0")


if __name__ == "__main__":
    unittest.main()
