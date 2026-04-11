from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.smoke_runner import run_smoke
from app.translators import TranslationResult


class FakeSmokeTranslator:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def translate(self, source_window: str) -> TranslationResult:
        self.calls.append(source_window)
        return TranslationResult(text=f"T::{source_window}")


class CliSmokeTests(unittest.TestCase):
    def test_smoke_command_joins_first_committed_events_and_prints_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "smoke.pc"
            path.write_text("p,preview\nc,one\np,again\nc,two\nc,three\n", encoding="utf-8")

            fake_translator = FakeSmokeTranslator()
            with patch("app.smoke_runner.LlmResponsesTranslator", return_value=fake_translator):
                result = run_smoke(path, committed_events=2)

        self.assertEqual(fake_translator.calls, ["onetwo"])
        self.assertEqual(result.committed_events, 2)
        self.assertEqual(result.source_text, "onetwo")
        self.assertEqual(result.target_text, "T::onetwo")


if __name__ == "__main__":
    unittest.main()
