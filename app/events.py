from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class ReplayEvent:
    kind: str
    text: str
    line_number: int


def parse_pc_line(raw_line: str, *, line_number: int) -> ReplayEvent:
    line = str(raw_line).rstrip("\r\n")
    if "," not in line:
        raise ValueError(f"line {line_number}: missing comma separator")
    kind, text = line.split(",", 1)
    if kind not in {"p", "c"}:
        raise ValueError(f"line {line_number}: invalid event kind {kind!r}")
    if kind == "c" and text == "":
        raise ValueError(f"line {line_number}: committed delta may not be empty")
    return ReplayEvent(kind=kind, text=text, line_number=line_number)


def load_pc_events(path: str | Path) -> list[ReplayEvent]:
    file_path = Path(path)
    events: list[ReplayEvent] = []
    with file_path.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.rstrip("\r\n")
            if line == "":
                raise ValueError(f"line {line_number}: blank lines are not valid events")
            events.append(parse_pc_line(line, line_number=line_number))
    return events


def iter_pc_events(path: str | Path) -> Iterable[ReplayEvent]:
    yield from load_pc_events(path)

