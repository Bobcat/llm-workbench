from __future__ import annotations

from fastapi import APIRouter

from app.image_pool.loras import router as image_pool_loras_router
from app.translation_services.proxy import router as translation_router
from app.translation_services.pdf import router as pdf_translation_router
from app.translation_services.benchmark import router as pdf_benchmark_router
from app.translation_services.pdf_regression import router as pdf_regression_router
from app.image_pool.models import router as image_pool_router
from app.image_pool.training import router as image_pool_training_router
from app.llm_pool.models import router as llm_pool_router
from app.prompt_testing.chat import router as chat_router
from app.prompt_testing.text_generation import router as text_generation_router
from app.realtime_tts.replay import router as realtime_tts_router
from app.realtime_translation.prompt_library.prompts import router as prompt_library_router
from app.realtime_translation.replay.defaults import router as replay_defaults_router
from app.realtime_translation.replay.replay import router as replay_router
from app.tts_pool.models import router as tts_pool_router
from app.video_pool.models import router as video_pool_router

api_router = APIRouter(prefix="/api")
api_router.include_router(llm_pool_router)
api_router.include_router(tts_pool_router)
api_router.include_router(image_pool_router)
api_router.include_router(image_pool_loras_router)
api_router.include_router(image_pool_training_router)
api_router.include_router(video_pool_router)
api_router.include_router(translation_router)
api_router.include_router(pdf_translation_router)
api_router.include_router(pdf_benchmark_router)
api_router.include_router(pdf_regression_router)
api_router.include_router(realtime_tts_router)
api_router.include_router(chat_router)
api_router.include_router(text_generation_router)
api_router.include_router(replay_defaults_router)
api_router.include_router(replay_router)
api_router.include_router(prompt_library_router)
