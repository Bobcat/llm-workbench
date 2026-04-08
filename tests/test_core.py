from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.core import TranslationCore
from app.events import ReplayEvent
from app.replay import ReplayRunner
from app.replay_settings import PreviewTranslationSettings
from app.source_state import SourceTranscriptState
from app.translators import Translator


class RecordingTranslator(Translator):
    def __init__(self) -> None:
        self.calls: list[str] = []

    def translate(self, source_window: str, *, context_text: str = "") -> str:
        self.calls.append(source_window)
        return f"T::{source_window}"


class WindowTranslator(Translator):
    def __init__(self, mapping: dict[str, str]) -> None:
        self.mapping = mapping
        self.calls: list[str] = []

    def translate(self, source_window: str, *, context_text: str = "") -> str:
        self.calls.append(source_window)
        return self.mapping[source_window]


class ContextRecordingTranslator(Translator):
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def translate(self, source_window: str, *, context_text: str = "") -> str:
        self.calls.append((source_window, context_text))
        return f"T::{source_window}"


class TranslationCoreTests(unittest.TestCase):
    def test_committed_source_event_clears_preview_state(self) -> None:
        source_state = SourceTranscriptState()

        source_state.apply_event(ReplayEvent(kind="p", text="preview", line_number=1))
        source_state.apply_event(ReplayEvent(kind="c", text="final", line_number=2))

        self.assertEqual(source_state.source_committed_text, "final")
        self.assertEqual(source_state.source_preview_text, "")

    def test_translation_core_only_triggers_on_committed_events(self) -> None:
        translator = RecordingTranslator()
        core = TranslationCore(translator=translator)
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

    def test_source_window_uses_open_source_chunks_until_boundary(self) -> None:
        translator = RecordingTranslator()
        core = TranslationCore(translator=translator)
        source_state = SourceTranscriptState()

        first_event = ReplayEvent(kind="c", text="one", line_number=1)
        source_state.apply_event(first_event)
        first_decision = core.handle_event(first_event, source_state)

        second_event = ReplayEvent(kind="c", text=" two", line_number=2)
        source_state.apply_event(second_event)
        second_decision = core.handle_event(second_event, source_state)

        third_event = ReplayEvent(kind="c", text=" three.", line_number=3)
        source_state.apply_event(third_event)
        third_decision = core.handle_event(third_event, source_state)

        self.assertTrue(first_decision.triggered)
        self.assertEqual(first_decision.source_window, "one")
        self.assertEqual(first_decision.source_chunks_used, 1)
        self.assertEqual(second_decision.source_window, "one\n two")
        self.assertEqual(second_decision.source_chunks_used, 2)
        self.assertEqual(third_decision.source_window, "one\n two\n three.")
        self.assertEqual(third_decision.source_chunks_used, 3)
        self.assertEqual(translator.calls, ["one", "one\n two", "one\n two\n three."])

    def test_target_state_commits_only_on_source_sentence_boundary(self) -> None:
        translator = WindowTranslator(
            {
                "Hello": "Hallo",
                "Hello\n world.": "Hallo wereld.",
                " How are": "Hoe gaat",
                " How are\n you?": "Hoe gaat het?",
            }
        )
        core = TranslationCore(translator=translator)
        source_state = SourceTranscriptState()

        first_event = ReplayEvent(kind="c", text="Hello", line_number=1)
        source_state.apply_event(first_event)
        first_decision = core.handle_event(first_event, source_state)

        second_event = ReplayEvent(kind="c", text=" world.", line_number=2)
        source_state.apply_event(second_event)
        second_decision = core.handle_event(second_event, source_state)

        third_event = ReplayEvent(kind="c", text=" How are", line_number=3)
        source_state.apply_event(third_event)
        third_decision = core.handle_event(third_event, source_state)

        fourth_event = ReplayEvent(kind="c", text=" you?", line_number=4)
        source_state.apply_event(fourth_event)
        fourth_decision = core.handle_event(fourth_event, source_state)

        self.assertEqual(first_decision.target_preview_text, "Hallo")
        self.assertEqual(second_decision.target_preview_text, "")
        self.assertEqual(third_decision.target_preview_text, "Hoe gaat")
        self.assertEqual(fourth_decision.target_preview_text, "")
        self.assertEqual(core.target_state.target_committed_text, "Hallo wereld. Hoe gaat het?")
        self.assertEqual(core.target_state.target_preview_text, "")
        self.assertEqual(
            translator.calls,
            ["Hello", "Hello\n world.", " How are", " How are\n you?"],
        )

    def test_translation_uses_previous_committed_chunk_as_context(self) -> None:
        translator = ContextRecordingTranslator()
        core = TranslationCore(translator=translator, context_committed_chunks=1)
        source_state = SourceTranscriptState()

        first_event = ReplayEvent(kind="c", text="Hello.", line_number=1)
        source_state.apply_event(first_event)
        core.handle_event(first_event, source_state)

        second_event = ReplayEvent(kind="c", text=" How are", line_number=2)
        source_state.apply_event(second_event)
        second_decision = core.handle_event(second_event, source_state)

        self.assertTrue(second_decision.triggered)
        self.assertEqual(translator.calls[0], ("Hello.", ""))
        self.assertEqual(translator.calls[1], (" How are", "Hello."))

    def test_preview_event_translates_when_preview_is_stable_and_long_enough(self) -> None:
        translator = WindowTranslator(
            {
                "Hello": "Hallo",
                "Hello\n world and more text": "Hallo wereld en meer tekst",
            }
        )
        preview_settings = PreviewTranslationSettings(
            enabled=True,
            min_chars=10,
            max_distance_ratio=0.30,
            min_growth_chars=10,
        )
        core = TranslationCore(translator=translator, preview_settings=preview_settings)
        source_state = SourceTranscriptState()

        committed_event = ReplayEvent(kind="c", text="Hello", line_number=1)
        source_state.apply_event(committed_event)
        core.handle_event(committed_event, source_state)

        preview_event_1 = ReplayEvent(kind="p", text=" world and more", line_number=2)
        source_state.apply_event(preview_event_1)
        first_preview_decision = core.handle_event(preview_event_1, source_state)

        preview_event_2 = ReplayEvent(kind="p", text=" world and more text", line_number=3)
        source_state.apply_event(preview_event_2)
        second_preview_decision = core.handle_event(preview_event_2, source_state)

        self.assertFalse(first_preview_decision.triggered)
        self.assertTrue(second_preview_decision.triggered)
        self.assertEqual(second_preview_decision.reason, "preview_event_translated")
        self.assertEqual(second_preview_decision.source_window, "Hello\n world and more text")
        self.assertEqual(core.target_state.target_preview_text, "Hallo wereld en meer tekst")
        self.assertEqual(translator.calls, ["Hello", "Hello\n world and more text"])

    def test_replay_of_small_example_keeps_preview_and_translates_on_c_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "small.pc"
            path.write_text("p,Hel\np,Hello\nc,Hello.\np,\np,How are you?\nc, How are you?\np,\n", encoding="utf-8")

            translator = RecordingTranslator()
            runner = ReplayRunner(core=TranslationCore(translator=translator))
            traces = runner.run_path(path)

        self.assertEqual(len(traces), 7)
        self.assertEqual(len(translator.calls), 2)
        self.assertEqual(translator.calls[0], "Hello.")
        self.assertEqual(translator.calls[1], " How are you?")
        self.assertEqual(runner.source_state.source_committed_text, "Hello. How are you?")
        self.assertEqual(runner.source_state.source_preview_text, "")
        self.assertEqual(runner.core.target_state.target_committed_text, "T::Hello. T:: How are you?")
        self.assertEqual(runner.core.target_state.target_preview_text, "")


if __name__ == "__main__":
    unittest.main()
