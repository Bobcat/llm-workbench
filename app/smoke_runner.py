from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

from app.events import load_pc_events
from app.translators import LlmResponsesTranslator, TranslationResult


@dataclass
class SmokeResult:
    committed_events: int
    source_chars: int
    source_text: str
    target_text: str
    latency_ms: float


def _collect_first_committed_text(path: Path, *, committed_events: int) -> str:
    chunks: list[str] = []
    for event in load_pc_events(path):
        if event.kind != "c":
            continue
        chunks.append(event.text)
        if len(chunks) >= committed_events:
            break
    if len(chunks) < committed_events:
        raise ValueError(
            f"{path}: only found {len(chunks)} committed events, need {committed_events}"
        )
    return "".join(chunks)


def run_smoke(path: Path, *, committed_events: int) -> SmokeResult:
    """Run smoke test on first N committed chunks."""
    translator = LlmResponsesTranslator()
    source_text = _collect_first_committed_text(path, committed_events=committed_events)
    started = time.perf_counter()
    translation = translator.translate(source_text)
    elapsed_ms = (time.perf_counter() - started) * 1000.0

    return SmokeResult(
        committed_events=committed_events,
        source_chars=len(source_text),
        source_text=source_text,
        target_text=translation.text,
        latency_ms=elapsed_ms,
    )
