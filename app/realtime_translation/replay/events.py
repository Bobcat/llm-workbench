from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

from realtime_translation_engine import SourceEvent

PC_HEADER = ("kind", "speech_start_ms", "speech_end_ms", "text")


@dataclass(frozen=True)
class SourceEventTiming:
    speech_start_ms: int
    speech_end_ms: int


@dataclass(frozen=True)
class LoadedPcEvents:
    events: list[SourceEvent]
    timings: list[SourceEventTiming]
    source_duration_ms: int


def parse_pc_line(raw_line: str, *, line_number: int) -> SourceEvent:
    line = str(raw_line).rstrip("\r\n")
    if line == "":
        raise ValueError(f"line {line_number}: blank lines are not valid events")
    try:
        row = next(csv.reader([line]))
    except csv.Error as exc:
        raise ValueError(f"line {line_number}: invalid CSV row") from exc
    return _source_event_from_pc_row(row, line_number=line_number)


def _source_event_from_pc_row(row: list[str], *, line_number: int) -> SourceEvent:
    event, _timing = _parse_pc_event_row(row, line_number=line_number)
    return event


def _parse_pc_event_row(row: list[str], *, line_number: int) -> tuple[SourceEvent, SourceEventTiming]:
    if len(row) != len(PC_HEADER):
        raise ValueError(f"line {line_number}: expected {len(PC_HEADER)} CSV columns")
    kind, speech_start_ms_raw, speech_end_ms_raw, text = row
    if kind not in {"p", "c"}:
        raise ValueError(f"line {line_number}: invalid event kind {kind!r}")
    if kind == "c" and text == "":
        raise ValueError(f"line {line_number}: committed delta may not be empty")
    speech_start_ms = _parse_ms(speech_start_ms_raw, line_number=line_number, field_name="speech_start_ms")
    speech_end_ms = _parse_ms(speech_end_ms_raw, line_number=line_number, field_name="speech_end_ms")
    if speech_end_ms < speech_start_ms:
        raise ValueError(f"line {line_number}: speech_end_ms may not be before speech_start_ms")
    return (
        SourceEvent(kind=kind, text=text, line_number=line_number),
        SourceEventTiming(speech_start_ms=speech_start_ms, speech_end_ms=speech_end_ms),
    )


def _parse_ms(raw_value: str, *, line_number: int, field_name: str) -> int:
    try:
        value = int(raw_value)
    except Exception as exc:
        raise ValueError(f"line {line_number}: invalid {field_name} {raw_value!r}") from exc
    if value < 0:
        raise ValueError(f"line {line_number}: invalid {field_name} {raw_value!r}")
    return value


def load_pc_events(path: str | Path) -> list[SourceEvent]:
    return load_pc_event_stream(path).events


def load_pc_event_stream(path: str | Path) -> LoadedPcEvents:
    file_path = Path(path)
    events: list[SourceEvent] = []
    timings: list[SourceEventTiming] = []
    with file_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        try:
            header = next(reader)
        except StopIteration as exc:
            raise ValueError("missing PC CSV header") from exc
        if tuple(header) != PC_HEADER:
            raise ValueError(f"line 1: invalid PC CSV header {header!r}")
        for row in reader:
            line_number = int(reader.line_num)
            if not row:
                raise ValueError(f"line {line_number}: blank lines are not valid events")
            event, timing = _parse_pc_event_row(row, line_number=line_number)
            events.append(event)
            timings.append(timing)
    source_duration_ms = max((timing.speech_end_ms for timing in timings), default=0)
    return LoadedPcEvents(events=events, timings=timings, source_duration_ms=source_duration_ms)
