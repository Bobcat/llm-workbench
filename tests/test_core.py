from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.core import TranslationCore
from app.events import ReplayEvent
from app.replay import ReplayRunner
from app.source_state import SourceTranscriptState
from app.translators import Translator


class RecordingTranslator(Translator):
    def __init__(self) -> None:
        self.calls: list[str] = []

    def translate(self, source_window: str) -> str:
        self.calls.append(source_window)
        return f"T::{source_window}"


class TranslationCoreTests(unittest.TestCase):
    def test_translation_core_only_triggers_on_committed_events(self) -> None:
        translator = RecordingTranslator()
        core = TranslationCore(translator=translator, window_chunks=2)
        source_state = SourceTranscriptState()

        preview_event = ReplayEvent(kind="p", text="preview", line_number=1)
        source_state.apply_event(preview_event)
        preview_decision = core.handle_event(preview_event, source_state)

        committed_event = ReplayEvent(kind="c", text="Hello.", line_number=2)
        source_state.apply_event(committed_event)
        committed_decision = core.handle_event(committed_event, source_state)

        self.assertFalse(preview_decision.triggered)
        self.assertTrue(committed_decision.triggered)
        self.assertEqual(translator.calls, ["Hello."])

    def test_source_window_uses_last_n_committed_chunks(self) -> None:
        translator = RecordingTranslator()
        core = TranslationCore(translator=translator, window_chunks=2)
        source_state = SourceTranscriptState(
            source_committed_text="one two three",
            source_preview_text="",
            committed_chunks=["one", "two", "three"],
        )
        event = ReplayEvent(kind="c", text="three", line_number=3)

        decision = core.handle_event(event, source_state)

        self.assertTrue(decision.triggered)
        self.assertEqual(decision.source_window, "two\nthree")
        self.assertEqual(translator.calls, ["two\nthree"])

    def test_replay_of_small_example_keeps_preview_and_translates_on_c_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "small.pc"
            path.write_text("p,Hel\np,Hello\nc,Hello.\np,\np,How are you?\nc, How are you?\np,\n", encoding="utf-8")

            translator = RecordingTranslator()
            runner = ReplayRunner(core=TranslationCore(translator=translator, window_chunks=2))
            traces = runner.run_path(path)

        self.assertEqual(len(traces), 7)
        self.assertEqual(len(translator.calls), 2)
        self.assertEqual(translator.calls[0], "Hello.")
        self.assertEqual(translator.calls[1], "Hello.\n How are you?")
        self.assertEqual(runner.source_state.source_committed_text, "Hello. How are you?")
        self.assertEqual(runner.source_state.source_preview_text, "")


if __name__ == "__main__":
    unittest.main()

