from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.realtime_translation.replay.settings import load_replay_settings


class ReplaySettingsTests(unittest.TestCase):
    def test_load_replay_settings_reads_preview_thresholds(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "settings.json"
            path.write_text(
                (
                    "{\n"
                    '  "replay": {\n'
                    '    "first_pass": {\n'
                    '      "default_model": "phi-4-ct2-int8",\n'
                    '      "source_language": "English",\n'
                    '      "target_language": "Dutch"\n'
                    "    },\n"
                    '    "preview_translation": {\n'
                    '      "enabled": true,\n'
                    '      "min_chars": 99,\n'
                    '      "max_distance_ratio": 0.25,\n'
                    '      "min_growth_chars": 33\n'
                    "    },\n"
                    '    "second_pass": {\n'
                    '      "enabled": false,\n'
                    '      "model": "eurollm-9b-ct2-int8"\n'
                    "    }\n"
                    "  }\n"
                    "}\n"
                ),
                encoding="utf-8",
            )

            settings = load_replay_settings(path)

        self.assertEqual(settings.first_pass.default_model, "phi-4-ct2-int8")
        self.assertEqual(settings.first_pass.source_language, "English")
        self.assertEqual(settings.first_pass.target_language, "Dutch")
        self.assertTrue(settings.preview_translation.enabled)
        self.assertEqual(settings.preview_translation.min_chars, 99)
        self.assertEqual(settings.preview_translation.max_distance_ratio, 0.25)
        self.assertEqual(settings.preview_translation.min_growth_chars, 33)
        self.assertFalse(settings.second_pass.enabled)
        self.assertEqual(settings.second_pass.model, "eurollm-9b-ct2-int8")

    def test_load_replay_settings_applies_local_json_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            local_path = Path(tmpdir) / "local.json"
            settings_path.write_text(
                (
                    "{\n"
                    '  "replay": {\n'
                    '    "first_pass": {\n'
                    '      "default_model": "phi-4-ct2-int8",\n'
                    '      "source_language": "English",\n'
                    '      "target_language": "Dutch"\n'
                    "    },\n"
                    '    "preview_translation": {\n'
                    '      "enabled": true,\n'
                    '      "min_chars": 90,\n'
                    '      "max_distance_ratio": 0.20,\n'
                    '      "min_growth_chars": 40\n'
                    "    },\n"
                    '    "second_pass": {\n'
                    '      "enabled": false,\n'
                    '      "model": "eurollm-9b-ct2-int8"\n'
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
                    '      "default_model": "gemma-4-31b-it-exl3-5.00bpw",\n'
                    '      "target_language": "German"\n'
                    "    },\n"
                    '    "preview_translation": {\n'
                    '      "min_chars": 120\n'
                    "    },\n"
                    '    "second_pass": {\n'
                    '      "enabled": true,\n'
                    '      "model": "phi-4-ct2-int8"\n'
                    "    }\n"
                    "  }\n"
                    "}\n"
                ),
                encoding="utf-8",
            )

            settings = load_replay_settings(settings_path)

        self.assertEqual(settings.first_pass.default_model, "gemma-4-31b-it-exl3-5.00bpw")
        self.assertEqual(settings.first_pass.source_language, "English")
        self.assertEqual(settings.first_pass.target_language, "German")
        self.assertTrue(settings.preview_translation.enabled)
        self.assertEqual(settings.preview_translation.min_chars, 120)
        self.assertEqual(settings.preview_translation.max_distance_ratio, 0.20)
        self.assertEqual(settings.preview_translation.min_growth_chars, 40)
        self.assertTrue(settings.second_pass.enabled)
        self.assertEqual(settings.second_pass.model, "phi-4-ct2-int8")

    def test_load_replay_settings_accepts_empty_local_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            local_path = Path(tmpdir) / "local.json"
            settings_path.write_text(
                (
                    "{\n"
                    '  "replay": {\n'
                    '    "first_pass": {\n'
                    '      "default_model": "google_gemma-4-E2B-it-Q5_K_M-gguf"\n'
                    "    },\n"
                    '    "second_pass": {\n'
                    '      "enabled": true,\n'
                    '      "model": "google_gemma-4-E4B-it-Q5_K_M-gguf"\n'
                    "    }\n"
                    "  }\n"
                    "}\n"
                ),
                encoding="utf-8",
            )
            local_path.write_text("", encoding="utf-8")

            settings = load_replay_settings(settings_path)

        self.assertEqual(settings.first_pass.default_model, "google_gemma-4-E2B-it-Q5_K_M-gguf")
        self.assertTrue(settings.second_pass.enabled)
        self.assertEqual(settings.second_pass.model, "google_gemma-4-E4B-it-Q5_K_M-gguf")


if __name__ == "__main__":
    unittest.main()
