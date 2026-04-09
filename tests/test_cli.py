from __future__ import annotations

import argparse
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from app.cli import run_smoke


class FakeSmokeTranslator:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def translate(self, source_window: str) -> str:
        self.calls.append(source_window)
        return f"T::{source_window}"


class CliSmokeTests(unittest.TestCase):
    def test_smoke_command_joins_first_committed_events_and_prints_result(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "smoke.pc"
            path.write_text("p,preview\nc,one\np,again\nc,two\nc,three\n", encoding="utf-8")

            output = StringIO()
            fake_translator = FakeSmokeTranslator()
            with patch("app.cli.LlmResponsesTranslator", return_value=fake_translator):
                with redirect_stdout(output):
                    exit_code = run_smoke(argparse.Namespace(path=path, c_count=2))

        self.assertEqual(exit_code, 0)
        self.assertEqual(fake_translator.calls, ["onetwo"])
        text = output.getvalue()
        self.assertIn("SMOKE RESULT", text)
        self.assertIn("committed_events=2", text)
        self.assertIn("SOURCE", text)
        self.assertIn("onetwo", text)
        self.assertIn("TARGET", text)
        self.assertIn("T::onetwo", text)


if __name__ == "__main__":
    unittest.main()
