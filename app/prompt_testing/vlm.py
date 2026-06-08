from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.prompt_testing.ad_hoc import _run_prompt_runner_payload

router = APIRouter(prefix="/vlm", tags=["vlm"])

_MAX_IMAGES = 4
_MAX_IMAGE_DATA_URL_CHARS = 12 * 1024 * 1024  # ~9 MiB binary after base64


class VlmImageInput(BaseModel):
    name: str = ""
    data_url: str


# llm-pool caps decoding.max_tokens at 4096 (see DecodingParams in llm-pool).
_MAX_OUTPUT_TOKENS = 4096
_DEFAULT_OUTPUT_TOKENS = 2048


class VlmRunRequest(BaseModel):
    model: str
    system_prompt: str = ""
    user_prompt: str = ""
    images: list[VlmImageInput] = Field(default_factory=list)
    allow_remote: bool = False
    max_tokens: int = Field(default=_DEFAULT_OUTPUT_TOKENS, ge=1, le=_MAX_OUTPUT_TOKENS)
    # Optional decode overrides; when omitted the previous defaults apply.
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, gt=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=1, le=200)


class VlmRunResponse(BaseModel):
    output_text: str
    model: str
    request_id: str
    image_count: int
    metrics: dict[str, float | int | None] = Field(default_factory=dict)


def _validate_images(images: list[VlmImageInput]) -> list[VlmImageInput]:
    if len(images) == 0:
        raise HTTPException(status_code=400, detail="At least one image is required.")
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
            raise HTTPException(
                status_code=400,
                detail="Each image must be base64-encoded.",
            )
        if len(url) > _MAX_IMAGE_DATA_URL_CHARS:
            raise HTTPException(status_code=400, detail="Image is too large.")
    return images


def _vlm_content_input(user_prompt: str, images: list[VlmImageInput]) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    text = str(user_prompt or "").strip()
    if text:
        content.append({"type": "text", "text": text})
    for image in images:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": str(image.data_url).strip()},
            }
        )
    return content


def _vlm_runner_payload(
    *,
    model: str,
    system_prompt: str,
    content_input: list[dict[str, Any]],
    allow_remote: bool,
    max_tokens: int = _DEFAULT_OUTPUT_TOKENS,
    temperature: float | None = None,
    top_p: float | None = None,
    top_k: int | None = None,
) -> dict[str, Any]:
    effective_system_prompt = system_prompt if str(system_prompt) != "" else " "
    clamped_max_tokens = max(1, min(_MAX_OUTPUT_TOKENS, int(max_tokens)))
    # Remote vision models (e.g. Moonshot kimi) constrain temperature to 0.6;
    # local backends are fine with a lower, more deterministic value.
    decoding: dict[str, Any] = {
        "max_tokens": clamped_max_tokens,
        "temperature": temperature if temperature is not None else (0.6 if allow_remote else 0.2),
        "top_p": top_p if top_p is not None else 0.95,
    }
    if top_k is not None:
        decoding["top_k"] = top_k
    return {
        "model": model,
        "input": content_input,
        "instructions": effective_system_prompt,
        "allow_remote": allow_remote,
        "stream": False,
        "decoding": decoding,
    }


@router.post("/run", response_model=VlmRunResponse)
def run_vlm(request: VlmRunRequest) -> VlmRunResponse:
    model = request.model.strip()
    if model == "":
        raise HTTPException(status_code=400, detail="Model must not be empty.")

    images = _validate_images(request.images)
    content_input = _vlm_content_input(request.user_prompt, images)
    if not content_input:
        raise HTTPException(status_code=400, detail="Provide a prompt or at least one image.")

    try:
        response_json, transport_completed_ms = _run_prompt_runner_payload(
            _vlm_runner_payload(
                model=model,
                system_prompt=request.system_prompt,
                content_input=content_input,
                allow_remote=request.allow_remote,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                top_p=request.top_p,
                top_k=request.top_k,
            )
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    metrics = response_json.get("metrics", {})
    if not isinstance(metrics, dict):
        metrics = {}
    return VlmRunResponse(
        output_text=str(response_json.get("output_text") or ""),
        model=str(response_json.get("model") or model),
        request_id=str(response_json.get("id") or ""),
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
