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
                    '    "context_committed_chunks": 2,\n'
                    '    "preview_translation": {\n'
                    '      "enabled": true,\n'
                    '      "min_chars": 99,\n'
                    '      "max_distance_ratio": 0.25,\n'
                    '      "min_growth_chars": 33\n'
                    "    }\n"
                    "  }\n"
                    "}\n"
                ),
                encoding="utf-8",
            )

            settings = load_replay_settings(path)

        self.assertEqual(settings.context_committed_chunks, 2)
        self.assertTrue(settings.preview_translation.enabled)
        self.assertEqual(settings.preview_translation.min_chars, 99)
        self.assertEqual(settings.preview_translation.max_distance_ratio, 0.25)
        self.assertEqual(settings.preview_translation.min_growth_chars, 33)


if __name__ == "__main__":
    unittest.main()
