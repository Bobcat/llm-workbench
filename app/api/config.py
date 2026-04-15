from __future__ import annotations

from fastapi import APIRouter

from app.replay_settings import load_replay_settings

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/default-model")
def get_default_model() -> dict[str, object]:
    """Get replay defaults from settings."""
    settings = load_replay_settings()
    return {
        "default_model": settings.first_pass.default_model,
        "commit_correction_enabled": settings.commit_correction.enabled,
        "commit_correction_model": settings.commit_correction.model,
    }
