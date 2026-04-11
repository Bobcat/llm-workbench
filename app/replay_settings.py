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
class FirstPassSettings:
    prompt: str = (
        "You are a translation engine. "
        "Translate the user's text into Dutch. "
        "Return only the translation."
    )
    input_template: str = "{{source_window}}"
    default_model: str = "phi-4-ct2-int8"


@dataclass(frozen=True)
class CommitCorrectionSettings:
    enabled: bool = True
    model: str = "phi-4-ct2-int8"
    prompt: str = (
        "Role: You are correcting a Dutch translation.\n"
        "Input: You receive source text and a draft Dutch translation.\n"
        "Task: Produce clean, idiomatic Dutch and correct clear language errors in the draft.\n"
        "Rule: If the draft contains malformed or non-Dutch words, replace them with the most likely correct Dutch wording.\n"
        "Rule: Fix obvious mistranscription effects from the source when the intended meaning is clear.\n"
        "Rule: Preserve meaning and factual content; do not add new information.\n"
        "Rule: If genuinely ambiguous, choose the safest natural Dutch wording closest to the source intent.\n"
        "Output: Return only the final corrected Dutch translation."
    )
    input_template: str = (
        "Source text:\n"
        "{{source_window}}\n\n"
        "Draft Dutch translation:\n"
        "{{draft_translation}}"
    )


@dataclass(frozen=True)
class ReplaySettings:
    first_pass: FirstPassSettings = field(default_factory=FirstPassSettings)
    preview_translation: PreviewTranslationSettings = field(default_factory=PreviewTranslationSettings)
    commit_correction: CommitCorrectionSettings = field(default_factory=CommitCorrectionSettings)


def _load_json_object(path: Path) -> dict[str, object]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return {}
    return dict(payload)


def _merge_json_objects(base: dict[str, object], override: dict[str, object]) -> dict[str, object]:
    merged: dict[str, object] = dict(base)
    for key, value in override.items():
        base_value = merged.get(key)
        if isinstance(base_value, dict) and isinstance(value, dict):
            merged[key] = _merge_json_objects(base_value, value)
        else:
            merged[key] = value
    return merged


def _coerce_prompt(value: object, *, default: str) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        lines = [str(item) for item in value]
        if lines:
            return "\n".join(lines)
    return default


def load_replay_settings(path: str | Path = DEFAULT_SETTINGS_PATH) -> ReplaySettings:
    settings_path = Path(path)
    payload = _load_json_object(settings_path)
    local_payload = _load_json_object(settings_path.with_name("local.json"))
    payload = _merge_json_objects(payload, local_payload)
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
    correction_payload = (
        replay_payload.get("commit_correction", {})
        if isinstance(replay_payload, dict)
        else {}
    )
    if not isinstance(first_pass_payload, dict):
        first_pass_payload = {}
    if not isinstance(preview_payload, dict):
        preview_payload = {}
    if not isinstance(correction_payload, dict):
        correction_payload = {}

    return ReplaySettings(
        first_pass=FirstPassSettings(
            prompt=_coerce_prompt(
                first_pass_payload.get("prompt"),
                default=FirstPassSettings.prompt,
            ),
            input_template=_coerce_prompt(
                first_pass_payload.get("input_template"),
                default=FirstPassSettings.input_template,
            ),
            default_model=str(
                first_pass_payload.get("default_model", FirstPassSettings.default_model)
            ),
        ),
        preview_translation=PreviewTranslationSettings(
            enabled=bool(preview_payload.get("enabled", True)),
            min_chars=int(preview_payload.get("min_chars", 80)),
            max_distance_ratio=float(preview_payload.get("max_distance_ratio", 0.15)),
            min_growth_chars=int(preview_payload.get("min_growth_chars", 50)),
        ),
        commit_correction=CommitCorrectionSettings(
            enabled=bool(correction_payload.get("enabled", True)),
            model=str(correction_payload.get("model", CommitCorrectionSettings.model)),
            prompt=_coerce_prompt(
                correction_payload.get("prompt"),
                default=CommitCorrectionSettings.prompt,
            ),
            input_template=_coerce_prompt(
                correction_payload.get("input_template"),
                default=CommitCorrectionSettings.input_template,
            ),
        ),
    )
