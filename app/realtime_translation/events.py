from __future__ import annotations

from pathlib import Path
from typing import Iterable

from realtime_translation_engine import SourceEvent


def parse_pc_line(raw_line: str, *, line_number: int) -> SourceEvent:
    line = str(raw_line).rstrip("\r\n")
    if "," not in line:
        raise ValueError(f"line {line_number}: missing comma separator")
    kind, text = line.split(",", 1)
    if kind not in {"p", "c"}:
        raise ValueError(f"line {line_number}: invalid event kind {kind!r}")
    if kind == "c" and text == "":
        raise ValueError(f"line {line_number}: committed delta may not be empty")
    return SourceEvent(kind=kind, text=text, line_number=line_number)


def load_pc_events(path: str | Path) -> list[SourceEvent]:
    file_path = Path(path)
    events: list[SourceEvent] = []
    with file_path.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.rstrip("\r\n")
            if line == "":
                raise ValueError(f"line {line_number}: blank lines are not valid events")
            events.append(parse_pc_line(line, line_number=line_number))
    return events


def iter_pc_events(path: str | Path) -> Iterable[SourceEvent]:
    yield from load_pc_events(path)
