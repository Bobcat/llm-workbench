from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.realtime_translation.replay.events import SourceEventTiming, load_pc_event_stream, load_pc_events, parse_pc_line
from realtime_translation_engine import SourceEvent


class ParserTests(unittest.TestCase):
    def test_parse_preview_line_allows_empty_payload(self) -> None:
        event = parse_pc_line("p,1000,1000,", line_number=2)
        self.assertEqual(event, SourceEvent(kind="p", text="", line_number=2))

    def test_parse_committed_line_keeps_csv_quoted_commas(self) -> None:
        event = parse_pc_line('c,1000,2000,"hello, world"', line_number=3)
        self.assertEqual(event.kind, "c")
        self.assertEqual(event.text, "hello, world")

    def test_parse_line_returns_source_event_without_timing_fields(self) -> None:
        event = parse_pc_line("c,1000,2000,hello", line_number=4)
        self.assertEqual(event, SourceEvent(kind="c", text="hello", line_number=4))

    def test_parse_line_rejects_invalid_timestamps(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid speech_start_ms"):
            parse_pc_line("c,not-a-number,2000,hello", line_number=4)

    def test_parse_committed_line_rejects_empty_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "committed delta may not be empty"):
            parse_pc_line("c,1000,2000,", line_number=5)

    def test_parse_line_rejects_old_two_column_format(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected 4 CSV columns"):
            parse_pc_line("c,hello", line_number=6)

    def test_load_pc_events_reads_new_csv_format(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "sample.pc"
            path.write_text(
                "kind,speech_start_ms,speech_end_ms,text\n"
                'p,0,500,"preview, text"\n'
                'c,0,1000,"commit, text"\n',
                encoding="utf-8",
            )
            self.assertEqual(
                load_pc_events(path),
                [
                    SourceEvent(kind="p", text="preview, text", line_number=2),
                    SourceEvent(kind="c", text="commit, text", line_number=3),
                ],
            )

    def test_load_pc_event_stream_keeps_timing_outside_source_events(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "sample.pc"
            path.write_text(
                "kind,speech_start_ms,speech_end_ms,text\n"
                "p,100,500,preview\n"
                "c,500,1200,commit\n",
                encoding="utf-8",
            )
            loaded = load_pc_event_stream(path)

        self.assertEqual(
            loaded.events,
            [
                SourceEvent(kind="p", text="preview", line_number=2),
                SourceEvent(kind="c", text="commit", line_number=3),
            ],
        )
        self.assertEqual(
            loaded.timings,
            [
                SourceEventTiming(speech_start_ms=100, speech_end_ms=500),
                SourceEventTiming(speech_start_ms=500, speech_end_ms=1200),
            ],
        )
        self.assertEqual(loaded.source_duration_ms, 1200)

    def test_load_pc_events_rejects_old_format_header(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "old.pc"
            path.write_text("p,hello\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "invalid PC CSV header"):
                load_pc_events(path)

    def test_load_pc_events_rejects_blank_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "broken.pc"
            path.write_text("kind,speech_start_ms,speech_end_ms,text\np,0,100,hello\n\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "blank lines are not valid events"):
                load_pc_events(path)


if __name__ == "__main__":
    unittest.main()
