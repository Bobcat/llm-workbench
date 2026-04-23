from __future__ import annotations

from fastapi import APIRouter

from app.realtime_translation.prompt_library.router import router as prompt_library_router
from app.realtime_translation.replay.router import router as replay_router

router = APIRouter()
router.include_router(replay_router)
router.include_router(prompt_library_router)
