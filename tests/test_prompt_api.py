from __future__ import annotations

import unittest

from app.realtime_translation.api.prompts import _render_translation_prompt_template


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


if __name__ == "__main__":
    unittest.main()
