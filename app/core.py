from __future__ import annotations

from dataclasses import dataclass
import time

from app.events import ReplayEvent
from app.replay_settings import PreviewTranslationSettings
from app.source_state import SourceTranscriptState
from app.translators import Translator


@dataclass
class TargetTranscriptState:
    target_committed_text: str = ""
    target_preview_text: str = ""


@dataclass
class TranslationDecision:
    triggered: bool
    reason: str
    source_window: str = ""
    target_preview_text: str = ""
    source_chunks_used: int = 0
    latency_ms: float = 0.0


class TranslationCore:
    def __init__(
        self,
        translator: Translator,
        *,
        preview_settings: PreviewTranslationSettings | None = None,
        context_committed_chunks: int = 1,
    ) -> None:
        self.translator = translator
        self.preview_settings = preview_settings or PreviewTranslationSettings()
        self.context_committed_chunks = max(0, int(context_committed_chunks))
        self.target_state = TargetTranscriptState()
        self.open_source_chunks: list[str] = []
        self.previous_source_preview_text = ""
        self.last_sent_source_preview_text = ""

    def handle_event(self, event: ReplayEvent, source_state: SourceTranscriptState) -> TranslationDecision:
        if event.kind == "p":
            return self._handle_preview_event(source_state)
        if event.kind != "c":
            return TranslationDecision(triggered=False, reason="unsupported_event_kind")

        self.open_source_chunks.append(event.text)
        source_window = self._build_source_window()
        if source_window == "":
            return TranslationDecision(triggered=False, reason="empty_committed_window")

        context_text = self._build_context_text(source_state)
        started = time.perf_counter()
        translated = self.translator.translate(source_window, context_text=context_text)
        latency_ms = (time.perf_counter() - started) * 1000.0
        source_chunks_used = len(self.open_source_chunks)
        if _ends_with_sentence_boundary(event.text):
            self.target_state.target_committed_text = _append_transcript_text(
                self.target_state.target_committed_text,
                translated,
            )
            self.target_state.target_preview_text = ""
            self.open_source_chunks.clear()
        else:
            self.target_state.target_preview_text = translated
        self._reset_preview_run_state()
        return TranslationDecision(
            triggered=True,
            reason="committed_event_translated",
            source_window=source_window,
            target_preview_text=self.target_state.target_preview_text,
            source_chunks_used=source_chunks_used,
            latency_ms=latency_ms,
        )

    def _build_source_window(self) -> str:
        chunks = [chunk for chunk in self.open_source_chunks if chunk]
        if not chunks:
            return ""
        return "\n".join(chunks)

    def _build_context_text(self, source_state: SourceTranscriptState) -> str:
        if self.context_committed_chunks <= 0:
            return ""
        preceding_count = max(0, len(source_state.committed_chunks) - len(self.open_source_chunks))
        if preceding_count == 0:
            return ""
        context_chunks = [
            chunk for chunk in source_state.committed_chunks[:preceding_count][-self.context_committed_chunks :]
            if chunk
        ]
        if not context_chunks:
            return ""
        return "\n".join(context_chunks)

    def _build_preview_source_window(self, source_preview_text: str) -> str:
        parts = [chunk for chunk in self.open_source_chunks if chunk]
        if source_preview_text.strip():
            parts.append(source_preview_text)
        if not parts:
            return ""
        return "\n".join(parts)

    def _handle_preview_event(self, source_state: SourceTranscriptState) -> TranslationDecision:
        preview_text = source_state.source_preview_text
        trimmed_preview = preview_text.rstrip()
        if trimmed_preview == "":
            self._reset_preview_run_state()
            return TranslationDecision(triggered=False, reason="empty_preview")

        previous_preview = self.previous_source_preview_text.rstrip()
        self.previous_source_preview_text = preview_text
        if not self.preview_settings.enabled:
            return TranslationDecision(triggered=False, reason="preview_translation_disabled")
        if previous_preview == "":
            return TranslationDecision(triggered=False, reason="preview_needs_previous_sample")
        if len(trimmed_preview) < self.preview_settings.min_chars:
            return TranslationDecision(triggered=False, reason="preview_below_min_chars")

        distance_ratio = _edit_distance_ratio(previous_preview, trimmed_preview)
        if distance_ratio > self.preview_settings.max_distance_ratio:
            return TranslationDecision(triggered=False, reason="preview_unstable")

        growth = max(0, len(trimmed_preview) - len(self.last_sent_source_preview_text.rstrip()))
        if growth < self.preview_settings.min_growth_chars:
            return TranslationDecision(triggered=False, reason="preview_not_grown_enough")

        source_window = self._build_preview_source_window(preview_text)
        if source_window == "":
            return TranslationDecision(triggered=False, reason="empty_preview_window")

        started = time.perf_counter()
        translated = self.translator.translate(source_window)
        latency_ms = (time.perf_counter() - started) * 1000.0
        self.target_state.target_preview_text = translated
        self.last_sent_source_preview_text = preview_text
        return TranslationDecision(
            triggered=True,
            reason="preview_event_translated",
            source_window=source_window,
            target_preview_text=translated,
            source_chunks_used=len(self.open_source_chunks) + 1,
            latency_ms=latency_ms,
        )

    def _reset_preview_run_state(self) -> None:
        self.previous_source_preview_text = ""
        self.last_sent_source_preview_text = ""


def _ends_with_sentence_boundary(text: str) -> bool:
    stripped = text.rstrip()
    if stripped == "":
        return False
    return stripped[-1] in ".?!"


def _append_transcript_text(existing: str, addition: str) -> str:
    if addition == "":
        return existing
    if existing == "":
        return addition
    if existing.endswith((" ", "\n")) or addition.startswith((" ", "\n")):
        return existing + addition
    return f"{existing} {addition}"


def _edit_distance_ratio(left: str, right: str) -> float:
    return _edit_distance(left, right) / max(len(left), len(right), 1)


def _edit_distance(left: str, right: str) -> int:
    right_len = len(right)
    previous = list(range(right_len + 1))
    for left_index, left_char in enumerate(left, start=1):
        current = [left_index] + [0] * right_len
        for right_index, right_char in enumerate(right, start=1):
            cost = 0 if left_char == right_char else 1
            current[right_index] = min(
                previous[right_index] + 1,
                current[right_index - 1] + 1,
                previous[right_index - 1] + cost,
            )
        previous = current
    return previous[right_len]
