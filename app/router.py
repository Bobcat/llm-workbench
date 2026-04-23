from __future__ import annotations

from fastapi import APIRouter

from app.llm_pool.router import router as llm_pool_router
from app.prompt_testing.router import router as prompt_testing_router
from app.realtime_translation.router import router as realtime_translation_router

api_router = APIRouter(prefix="/api")
api_router.include_router(llm_pool_router)
api_router.include_router(prompt_testing_router)
api_router.include_router(realtime_translation_router)
