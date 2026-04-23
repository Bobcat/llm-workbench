from __future__ import annotations

from fastapi import APIRouter

from app.prompt_testing import ad_hoc

router = APIRouter()
router.include_router(ad_hoc.router)
