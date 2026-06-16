"""Prompt test endpoint: run a prompt template against a model via the realtime engine.

The prompt library itself now lives in translation-services (/api/translation/prompts);
this router only keeps ``/prompts/test-translation``, used by the Prompt Library view's
"Run" button to try a system/user template against a model.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from realtime_translation_engine.translators import LlmResponsesTranslator
from realtime_translation_engine.translators import render_translation_template

router = APIRouter(prefix="/prompts", tags=["prompts"])


class PromptTestRequest(BaseModel):
    model: str
    system_prompt: str = ""
    user_prompt_template: str
    source_text: str = ""
    draft_translation: str = ""
    source_language: str = "English"
    target_language: str = "Dutch"


class PromptTestResponse(BaseModel):
    output_text: str
    model: str
    request_id: str
    rendered_user_prompt: str
    metrics: dict[str, float | int | None] = Field(default_factory=dict)


def _render_translation_prompt_template(
    template: str,
    *,
    source_text: str,
    draft_translation: str,
    source_language: str,
    target_language: str,
) -> str:
    return render_translation_template(
        str(template or ""),
        source_window=str(source_text or ""),
        draft_translation=str(draft_translation or ""),
        source_language=str(source_language or ""),
        target_language=str(target_language or ""),
    )


@router.post("/test-translation", response_model=PromptTestResponse)
def test_translation_prompt(request: PromptTestRequest) -> PromptTestResponse:
    model = request.model.strip()
    system_prompt = request.system_prompt
    user_prompt_template = request.user_prompt_template
    if model == "":
        raise HTTPException(status_code=400, detail="Model must not be empty.")
    if str(user_prompt_template).strip() == "":
        raise HTTPException(status_code=400, detail="User prompt template must not be empty.")

    translator = LlmResponsesTranslator(
        model=model,
        second_pass_model=model,
    )
    rendered_system_prompt = _render_translation_prompt_template(
        system_prompt,
        source_text=request.source_text,
        draft_translation=request.draft_translation,
        source_language=request.source_language,
        target_language=request.target_language,
    )
    rendered_user_prompt = _render_translation_prompt_template(
        user_prompt_template,
        source_text=request.source_text,
        draft_translation=request.draft_translation,
        source_language=request.source_language,
        target_language=request.target_language,
    )
    if rendered_user_prompt.strip() == "":
        raise HTTPException(status_code=400, detail="Rendered user prompt must not be empty.")

    try:
        result = translator.translate_with_system_prompt(
            rendered_user_prompt,
            system_prompt=rendered_system_prompt,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    metrics = result.metrics
    return PromptTestResponse(
        output_text=result.text,
        model=result.model,
        request_id=result.request_id,
        rendered_user_prompt=rendered_user_prompt,
        metrics={
            "transport_first_byte_ms": metrics.transport_first_byte_ms,
            "transport_first_text_delta_ms": metrics.transport_first_text_delta_ms,
            "transport_completed_ms": metrics.transport_completed_ms,
            "engine_tokenize_ms": metrics.engine_tokenize_ms,
            "gpu_time_to_first_token_ms": metrics.gpu_time_to_first_token_ms,
            "gpu_generate_total_ms": metrics.gpu_generate_total_ms,
            "gpu_decode_after_first_token_ms": metrics.gpu_decode_after_first_token_ms,
            "engine_prompt_tokens": metrics.engine_prompt_tokens,
            "engine_output_tokens": metrics.engine_output_tokens,
            "engine_tokens_per_second": metrics.engine_tokens_per_second,
        },
    )
