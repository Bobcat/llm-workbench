from __future__ import annotations

from dataclasses import dataclass

from app.events import ReplayEvent
from app.source_state import SourceTranscriptState
from app.translators import Translator


@dataclass
class TargetTranscriptState:
    target_committed_text: str = ""
    target_tail_text: str = ""


@dataclass
class TranslationDecision:
    triggered: bool
    reason: str
    source_window: str = ""
    target_tail_text: str = ""
    window_chunks_used: int = 0


class TranslationCore:
    def __init__(self, translator: Translator, *, window_chunks: int = 2) -> None:
        self.translator = translator
        self.window_chunks = max(1, int(window_chunks))
        self.target_state = TargetTranscriptState()

    def handle_event(self, event: ReplayEvent, source_state: SourceTranscriptState) -> TranslationDecision:
        if event.kind != "c":
            return TranslationDecision(triggered=False, reason="preview_event_no_translation")

        source_window = self._build_source_window(source_state)
        if source_window == "":
            return TranslationDecision(triggered=False, reason="empty_committed_window")

        translated = self.translator.translate(source_window)
        self.target_state.target_tail_text = translated
        return TranslationDecision(
            triggered=True,
            reason="committed_event_translated",
            source_window=source_window,
            target_tail_text=translated,
            window_chunks_used=min(self.window_chunks, len(source_state.committed_chunks)),
        )

    def _build_source_window(self, source_state: SourceTranscriptState) -> str:
        chunks = [chunk for chunk in source_state.committed_chunks if chunk]
        if not chunks:
            return ""
        return "\n".join(chunks[-self.window_chunks :])

