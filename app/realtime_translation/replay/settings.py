from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
import json
from pathlib import Path

from realtime_translation_engine import PreviewTranslationSettings
from app.settings_files import load_object, merge_objects


DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parents[3] / "config" / "settings.json"


@dataclass(frozen=True)
class FirstPassSettings:
    default_model: str = "google_gemma-4-E2B-it-Q5_K_M-gguf"
    source_language: str = "English"
    target_language: str = "Dutch"


@dataclass(frozen=True)
class SecondPassSettings:
    enabled: bool = True
    model: str = "google_gemma-4-E4B-it-Q5_K_M-gguf"


@dataclass(frozen=True)
class ReplaySettings:
    first_pass: FirstPassSettings = field(default_factory=FirstPassSettings)
    preview_translation: PreviewTranslationSettings = field(default_factory=PreviewTranslationSettings)
    second_pass: SecondPassSettings = field(default_factory=SecondPassSettings)


def load_replay_settings(path: str | Path = DEFAULT_SETTINGS_PATH) -> ReplaySettings:
    settings_path = Path(path)
    payload = load_object(settings_path)
    local_payload = load_object(settings_path.with_name("local.json"))
    payload = merge_objects(payload, local_payload)
    replay_payload = payload.get("replay", {}) if isinstance(payload, dict) else {}
    first_pass_payload = (
        replay_payload.get("first_pass", {})
        if isinstance(replay_payload, dict)
        else {}
    )
    preview_payload = (
        replay_payload.get("preview_translation", {})
        if isinstance(replay_payload, dict)
        else {}
    )
    second_pass_payload = (
        replay_payload.get("second_pass", {})
        if isinstance(replay_payload, dict)
        else {}
    )
    if not isinstance(first_pass_payload, dict):
        first_pass_payload = {}
    if not isinstance(preview_payload, dict):
        preview_payload = {}
    if not isinstance(second_pass_payload, dict):
        second_pass_payload = {}

    return ReplaySettings(
        first_pass=FirstPassSettings(
            default_model=str(
                first_pass_payload.get("default_model", FirstPassSettings.default_model)
            ),
            source_language=str(
                first_pass_payload.get("source_language", FirstPassSettings.source_language)
            ),
            target_language=str(
                first_pass_payload.get("target_language", FirstPassSettings.target_language)
            ),
        ),
        preview_translation=PreviewTranslationSettings(
            enabled=bool(preview_payload.get("enabled", True)),
            min_chars=int(preview_payload.get("min_chars", 80)),
            max_distance_ratio=float(preview_payload.get("max_distance_ratio", 0.15)),
            min_growth_chars=int(preview_payload.get("min_growth_chars", 50)),
        ),
        second_pass=SecondPassSettings(
            enabled=bool(second_pass_payload.get("enabled", True)),
            model=str(second_pass_payload.get("model", SecondPassSettings.model)),
        ),
    )
