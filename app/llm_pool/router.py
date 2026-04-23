from __future__ import annotations

from fastapi import APIRouter

from app.llm_pool import models

router = APIRouter()
router.include_router(models.router)
