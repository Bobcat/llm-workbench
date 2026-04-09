from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.replay_settings import load_replay_settings


class ReplaySettingsTests(unittest.TestCase):
    def test_load_replay_settings_reads_preview_thresholds(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "settings.json"
            path.write_text(
                (
                    "{\n"
                    '  "replay": {\n'
                    '    "first_pass": {\n'
                    '      "prompt": "Translate to Dutch. Return only Dutch.",\n'
                    '      "input_template": "FIRST: {{source_window}}"\n'
                    "    },\n"
                    '    "preview_translation": {\n'
                    '      "enabled": true,\n'
                    '      "min_chars": 99,\n'
                    '      "max_distance_ratio": 0.25,\n'
                    '      "min_growth_chars": 33\n'
                    "    },\n"
                    '    "commit_correction": {\n'
                    '      "enabled": false,\n'
                    '      "model": "eurollm-9b-ct2-int8",\n'
                    '      "prompt": "Correct every error.",\n'
                    '      "input_template": "SRC={{source_window}} DRAFT={{draft_translation}}"\n'
                    "    }\n"
                    "  }\n"
                    "}\n"
                ),
                encoding="utf-8",
            )

            settings = load_replay_settings(path)

        self.assertEqual(settings.first_pass.prompt, "Translate to Dutch. Return only Dutch.")
        self.assertEqual(settings.first_pass.input_template, "FIRST: {{source_window}}")
        self.assertTrue(settings.preview_translation.enabled)
        self.assertEqual(settings.preview_translation.min_chars, 99)
        self.assertEqual(settings.preview_translation.max_distance_ratio, 0.25)
        self.assertEqual(settings.preview_translation.min_growth_chars, 33)
        self.assertFalse(settings.commit_correction.enabled)
        self.assertEqual(settings.commit_correction.model, "eurollm-9b-ct2-int8")
        self.assertEqual(settings.commit_correction.prompt, "Correct every error.")
        self.assertEqual(
            settings.commit_correction.input_template,
            "SRC={{source_window}} DRAFT={{draft_translation}}",
        )

    def test_load_replay_settings_applies_local_json_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            local_path = Path(tmpdir) / "local.json"
            settings_path.write_text(
                (
                    "{\n"
                    '  "replay": {\n'
                    '    "first_pass": {\n'
                    '      "prompt": "Base first-pass prompt.",\n'
                    '      "input_template": "Base input {{source_window}}"\n'
                    "    },\n"
                    '    "preview_translation": {\n'
                    '      "enabled": true,\n'
                    '      "min_chars": 90,\n'
                    '      "max_distance_ratio": 0.20,\n'
                    '      "min_growth_chars": 40\n'
                    "    },\n"
                    '    "commit_correction": {\n'
                    '      "enabled": false,\n'
                    '      "model": "eurollm-9b-ct2-int8",\n'
                    '      "prompt": "Base prompt.",\n'
                    '      "input_template": "Base source={{source_window}} draft={{draft_translation}}"\n'
                    "    }\n"
                    "  }\n"
                    "}\n"
                ),
                encoding="utf-8",
            )
            local_path.write_text(
                (
                    "{\n"
                    '  "replay": {\n'
                    '    "first_pass": {\n'
                    '      "prompt": "Local first-pass prompt.",\n'
                    '      "input_template": "Local input {{source_window}}"\n'
                    "    },\n"
                    '    "preview_translation": {\n'
                    '      "min_chars": 120\n'
                    "    },\n"
                    '    "commit_correction": {\n'
                    '      "enabled": true,\n'
                    '      "model": "phi-4-ct2-int8",\n'
                    '      "prompt": [\n'
                    '        "Local line 1.",\n'
                    '        "Local line 2."\n'
                    "      ],\n"
                    '      "input_template": [\n'
                    '        "Local source {{source_window}}",\n'
                    '        "Local draft {{draft_translation}}"\n'
                    "      ]\n"
                    "    }\n"
                    "  }\n"
                    "}\n"
                ),
                encoding="utf-8",
            )

            settings = load_replay_settings(settings_path)

        self.assertEqual(settings.first_pass.prompt, "Local first-pass prompt.")
        self.assertEqual(settings.first_pass.input_template, "Local input {{source_window}}")
        self.assertTrue(settings.preview_translation.enabled)
        self.assertEqual(settings.preview_translation.min_chars, 120)
        self.assertEqual(settings.preview_translation.max_distance_ratio, 0.20)
        self.assertEqual(settings.preview_translation.min_growth_chars, 40)
        self.assertTrue(settings.commit_correction.enabled)
        self.assertEqual(settings.commit_correction.model, "phi-4-ct2-int8")
        self.assertEqual(settings.commit_correction.prompt, "Local line 1.\nLocal line 2.")
        self.assertEqual(
            settings.commit_correction.input_template,
            "Local source {{source_window}}\nLocal draft {{draft_translation}}",
        )


if __name__ == "__main__":
    unittest.main()
