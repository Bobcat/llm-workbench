from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.prompt_testing.pool_client import _run_prompt_runner_payload

router = APIRouter(prefix="/text-generation", tags=["text-generation"])

_MAX_IMAGES = 4
_MAX_IMAGE_DATA_URL_CHARS = 12 * 1024 * 1024  # ~9 MiB binary after base64

# llm-pool caps decoding.max_tokens at 4096 (see DecodingParams in llm-pool).
_MAX_OUTPUT_TOKENS = 4096
_DEFAULT_OUTPUT_TOKENS = 2048


class TextGenerationFileInput(BaseModel):
    name: str
    content: str = ""


class TextGenerationImageInput(BaseModel):
    name: str = ""
    data_url: str


class TextGenerationRunRequest(BaseModel):
    model: str
    system_prompt: str = ""
    user_prompt: str = ""
    files: list[TextGenerationFileInput] = Field(default_factory=list)
    images: list[TextGenerationImageInput] = Field(default_factory=list)
    allow_remote: bool = False
    thinking: Literal["default", "enabled", "disabled"] = "default"
    max_tokens: int = Field(default=_DEFAULT_OUTPUT_TOKENS, ge=1, le=_MAX_OUTPUT_TOKENS)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, gt=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=1, le=200)


class TextGenerationRunResponse(BaseModel):
    output_text: str
    model: str
    request_id: str
    rendered_user_prompt: str
    file_count: int
    image_count: int
    metrics: dict[str, float | int | None] = Field(default_factory=dict)


def _render_user_prompt_with_attachments(
    user_prompt: str,
    *,
    files: list[TextGenerationFileInput],
) -> str:
    prompt_text = str(user_prompt or "").rstrip("\n")
    parts: list[str] = []
    if prompt_text:
        parts.append(prompt_text)

    attachment_lines: list[str] = []
    for file in files:
        file_name = str(file.name or "").strip()
        if file_name == "":
            continue
        file_content = str(file.content or "").rstrip("\n")
        attachment_lines.extend(
            [
                f"Name: {file_name}",
                "Contents:",
                "=====",
                file_content,
                "=====",
            ]
        )

    if attachment_lines:
        parts.append("ATTACHMENTS:")
        parts.extend(attachment_lines)

    return "\n".join(parts)


def _validate_images(
    images: list[TextGenerationImageInput],
) -> list[TextGenerationImageInput]:
    if len(images) > _MAX_IMAGES:
        raise HTTPException(status_code=400, detail=f"At most {_MAX_IMAGES} images are allowed.")
    for image in images:
        url = str(image.data_url or "").strip()
        if not url.startswith("data:image/"):
            raise HTTPException(
                status_code=400,
                detail="Each image must be a data:image/... base64 URL.",
            )
        if ";base64," not in url:
            raise HTTPException(status_code=400, detail="Each image must be base64-encoded.")
        if len(url) > _MAX_IMAGE_DATA_URL_CHARS:
            raise HTTPException(status_code=400, detail="Image is too large.")
    return images


def _image_content_items(
    images: list[TextGenerationImageInput],
) -> list[dict[str, Any]]:
    return [
        {"type": "image_url", "image_url": {"url": str(image.data_url).strip()}}
        for image in images
    ]


def _text_generation_input(
    rendered_user_prompt: str,
    images: list[TextGenerationImageInput],
) -> str | list[dict[str, Any]]:
    if not images:
        return rendered_user_prompt

    content: list[dict[str, Any]] = []
    text = str(rendered_user_prompt or "").strip()
    if text:
        content.append({"type": "text", "text": rendered_user_prompt})
    content.extend(_image_content_items(images))
    return content


def _decoding(request: TextGenerationRunRequest) -> dict[str, Any]:
    clamped_max_tokens = max(1, min(_MAX_OUTPUT_TOKENS, int(request.max_tokens)))
    decoding: dict[str, Any] = {
        "max_tokens": clamped_max_tokens,
        "temperature": request.temperature
        if request.temperature is not None
        else (0.6 if request.allow_remote else 0.2),
        "top_p": request.top_p if request.top_p is not None else 0.95,
    }
    if request.top_k is not None:
        decoding["top_k"] = request.top_k
    return decoding


def _text_generation_payload(
    request: TextGenerationRunRequest,
    *,
    model: str,
    rendered_user_prompt: str,
    images: list[TextGenerationImageInput],
) -> dict[str, Any]:
    effective_system_prompt = (
        request.system_prompt if str(request.system_prompt) != "" else " "
    )
    return {
        "model": model,
        "input": _text_generation_input(rendered_user_prompt, images),
        "instructions": effective_system_prompt,
        "allow_remote": request.allow_remote,
        "stream": False,
        "thinking": request.thinking,
        "decoding": _decoding(request),
    }


@router.post("/run", response_model=TextGenerationRunResponse)
def run_text_generation(
    request: TextGenerationRunRequest,
) -> TextGenerationRunResponse:
    model = request.model.strip()
    if model == "":
        raise HTTPException(status_code=400, detail="Model must not be empty.")

    images = _validate_images(request.images)
    rendered_user_prompt = _render_user_prompt_with_attachments(
        request.user_prompt,
        files=request.files,
    )
    if rendered_user_prompt.strip() == "" and len(images) == 0:
        raise HTTPException(status_code=400, detail="Provide a prompt, file, or image.")

    try:
        response_json, transport_completed_ms = _run_prompt_runner_payload(
            _text_generation_payload(
                request,
                model=model,
                rendered_user_prompt=rendered_user_prompt,
                images=images,
            )
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    metrics = response_json.get("metrics", {})
    if not isinstance(metrics, dict):
        metrics = {}
    return TextGenerationRunResponse(
        output_text=str(response_json.get("output_text") or ""),
        model=str(response_json.get("model") or model),
        request_id=str(response_json.get("id") or ""),
        rendered_user_prompt=rendered_user_prompt,
        file_count=len(request.files),
        image_count=len(images),
        metrics={
            "transport_completed_ms": transport_completed_ms,
            "engine_tokenize_ms": metrics.get("engine_tokenize_ms"),
            "gpu_time_to_first_token_ms": metrics.get("gpu_time_to_first_token_ms"),
            "gpu_generate_total_ms": metrics.get("gpu_generate_total_ms"),
            "gpu_decode_after_first_token_ms": metrics.get("gpu_decode_after_first_token_ms"),
            "engine_prompt_tokens": metrics.get("engine_prompt_tokens"),
            "engine_output_tokens": metrics.get("engine_output_tokens"),
            "engine_tokens_per_second": metrics.get("engine_tokens_per_second"),
        },
    )
