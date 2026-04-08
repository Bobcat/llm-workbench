from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.core import TargetTranscriptState, TranslationCore, TranslationDecision
from app.events import ReplayEvent, load_pc_events
from app.source_state import SourceTranscriptState


@dataclass
class ReplayTrace:
    event_index: int
    event: ReplayEvent
    source_state: SourceTranscriptState
    target_state: TargetTranscriptState
    decision: TranslationDecision


class ReplayRunner:
    def __init__(self, *, core: TranslationCore) -> None:
        self.core = core
        self.source_state = SourceTranscriptState()

    def run_path(self, path: str | Path, *, max_events: int | None = None) -> list[ReplayTrace]:
        events = load_pc_events(path)
        traces: list[ReplayTrace] = []
        for event_index, event in enumerate(events, start=1):
            if max_events is not None and event_index > max_events:
                break
            traces.append(self.process_event(event_index, event))
        return traces

    def process_event(self, event_index: int, event: ReplayEvent) -> ReplayTrace:
        self.source_state.apply_event(event)
        decision = self.core.handle_event(event, self.source_state)
        return ReplayTrace(
            event_index=event_index,
            event=event,
            source_state=SourceTranscriptState(
                source_committed_text=self.source_state.source_committed_text,
                source_preview_text=self.source_state.source_preview_text,
                committed_chunks=list(self.source_state.committed_chunks),
            ),
            target_state=TargetTranscriptState(
                target_committed_text=self.core.target_state.target_committed_text,
                target_preview_text=self.core.target_state.target_preview_text,
            ),
            decision=decision,
        )
