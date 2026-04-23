from __future__ import annotations

from fastapi import APIRouter

from app.realtime_translation.api import defaults, prompts, replay

router = APIRouter()
router.include_router(defaults.router)
router.include_router(prompts.router)
router.include_router(replay.router)
