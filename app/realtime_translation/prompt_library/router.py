from __future__ import annotations

from fastapi import APIRouter

from app.realtime_translation.prompt_library import prompts

router = APIRouter()
router.include_router(prompts.router)
