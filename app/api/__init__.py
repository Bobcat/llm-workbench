from __future__ import annotations

from fastapi import APIRouter

from app.api import config, models, replay, smoke

api_router = APIRouter(prefix="/api")
api_router.include_router(config.router)
api_router.include_router(models.router)
api_router.include_router(replay.router)
api_router.include_router(smoke.router)


@api_router.get("/workflows")
def list_workflows() -> list[dict[str, str]]:
    """List available workflows for the UI."""
    return [
        {
            "id": "replay",
            "name": "Replayer",
            "description": "Replay transcript events and inspect translations",
            "icon": "play_circle",
        }
    ]
