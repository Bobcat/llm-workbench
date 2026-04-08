from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.events import ReplayEvent, load_pc_events, parse_pc_line


class ParserTests(unittest.TestCase):
    def test_parse_preview_line_allows_empty_payload(self) -> None:
        event = parse_pc_line("p,", line_number=1)
        self.assertEqual(event, ReplayEvent(kind="p", text="", line_number=1))

    def test_parse_committed_line_keeps_text_after_first_comma(self) -> None:
        event = parse_pc_line("c,hello, world", line_number=2)
        self.assertEqual(event.kind, "c")
        self.assertEqual(event.text, "hello, world")

    def test_parse_committed_line_rejects_empty_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "committed delta may not be empty"):
            parse_pc_line("c,", line_number=3)

    def test_load_pc_events_rejects_blank_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "broken.pc"
            path.write_text("p,hello\n\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "blank lines are not valid events"):
                load_pc_events(path)


if __name__ == "__main__":
    unittest.main()

