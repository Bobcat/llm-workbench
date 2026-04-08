from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
import json
from pathlib import Path


DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parents[1] / "settings.json"


@dataclass(frozen=True)
class PreviewTranslationSettings:
    enabled: bool = True
    min_chars: int = 80
    max_distance_ratio: float = 0.15
    min_growth_chars: int = 50


@dataclass(frozen=True)
class ReplaySettings:
    context_committed_chunks: int = 1
    preview_translation: PreviewTranslationSettings = field(default_factory=PreviewTranslationSettings)


def load_replay_settings(path: str | Path = DEFAULT_SETTINGS_PATH) -> ReplaySettings:
    settings_path = Path(path)
    if not settings_path.exists():
        return ReplaySettings()

    payload = json.loads(settings_path.read_text(encoding="utf-8"))
    replay_payload = payload.get("replay", {}) if isinstance(payload, dict) else {}
    preview_payload = (
        replay_payload.get("preview_translation", {})
        if isinstance(replay_payload, dict)
        else {}
    )
    if not isinstance(preview_payload, dict):
        preview_payload = {}

    return ReplaySettings(
        context_committed_chunks=max(0, int(replay_payload.get("context_committed_chunks", 1))),
        preview_translation=PreviewTranslationSettings(
            enabled=bool(preview_payload.get("enabled", True)),
            min_chars=int(preview_payload.get("min_chars", 80)),
            max_distance_ratio=float(preview_payload.get("max_distance_ratio", 0.15)),
            min_growth_chars=int(preview_payload.get("min_growth_chars", 50)),
        )
    )
