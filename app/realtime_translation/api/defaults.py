from __future__ import annotations

from fastapi import APIRouter

from app.realtime_translation.settings import load_replay_settings

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/default-model")
def get_default_model() -> dict[str, object]:
    """Get replay defaults from settings."""
    settings = load_replay_settings()
    preview = settings.preview_translation
    replay_params_label = (
        "sentence_gate=source; "
        f"preview={'enabled' if preview.enabled else 'disabled'}, "
        f"min_chars={preview.min_chars}, "
        f"ratio<={preview.max_distance_ratio:.2f}, "
        f"growth>={preview.min_growth_chars}"
    )
    return {
        "default_model": settings.first_pass.default_model,
        "commit_correction_enabled": settings.commit_correction.enabled,
        "commit_correction_model": settings.commit_correction.model,
        "preview_translation": {
            "enabled": preview.enabled,
            "min_chars": preview.min_chars,
            "max_distance_ratio": preview.max_distance_ratio,
            "min_growth_chars": preview.min_growth_chars,
        },
        "replay_params_label": replay_params_label,
    }
