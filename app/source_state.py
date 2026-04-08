from __future__ import annotations

from dataclasses import dataclass, field

from app.events import ReplayEvent


@dataclass
class SourceTranscriptState:
    source_committed_text: str = ""
    source_preview_text: str = ""
    committed_chunks: list[str] = field(default_factory=list)

    def apply_event(self, event: ReplayEvent) -> None:
        if event.kind == "p":
            self.source_preview_text = event.text
            return
        if event.kind == "c":
            self.source_committed_text += event.text
            self.committed_chunks.append(event.text)
            return
        raise ValueError(f"unsupported event kind: {event.kind!r}")

