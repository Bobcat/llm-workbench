from __future__ import annotations

from fastapi import APIRouter

from app.api import config, models, replay, smoke

api_router = APIRouter(prefix="/api")
api_router.include_router(config.router)
api_router.include_router(models.router)
api_router.include_router(replay.router)
api_router.include_router(smoke.router)
