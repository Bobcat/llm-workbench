from __future__ import annotations

from fastapi import APIRouter

from app.realtime_translation.replay import defaults, replay

router = APIRouter()
router.include_router(defaults.router)
router.include_router(replay.router)
