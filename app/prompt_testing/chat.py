from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.prompt_testing.pool_client import _run_prompt_runner_payload

router = APIRouter(prefix="/chat", tags=["chat"])

_MAX_IMAGES_PER_TURN = 4
_MAX_IMAGE_DATA_URL_CHARS = 12 * 1024 * 1024  # ~9 MiB binary after base64

# llm-pool caps decoding.max_tokens at 4096 (see DecodingParams in llm-pool).
_MAX_OUTPUT_TOKENS = 4096
_DEFAULT_OUTPUT_TOKENS = 2048


class ChatImageInput(BaseModel):
    name: str = ""
    data_url: str


class ChatTurnInput(BaseModel):
    role: Literal["user", "assistant"]
    text: str = ""
    images: list[ChatImageInput] = Field(default_factory=list)


class ChatRunRequest(BaseModel):
    model: str
    system_prompt: str = ""
    turns: list[ChatTurnInput] = Field(default_factory=list)
    # Whether the target model supports native multi-turn (Route B). When false
    # the conversation is flattened into a single prompt (Route A).
    multi_turn: bool = True
    allow_remote: bool = False
    thinking: Literal["default", "enabled", "disabled"] = "default"
    max_tokens: int = Field(default=_DEFAULT_OUTPUT_TOKENS, ge=1, le=_MAX_OUTPUT_TOKENS)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, gt=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=1, le=200)


class ChatRunResponse(BaseModel):
    output_text: str
    model: str
    request_id: str
    multi_turn: bool
    metrics: dict[str, float | int | None] = Field(default_factory=dict)


def _validate_turns(turns: list[ChatTurnInput]) -> list[ChatTurnInput]:
    if len(turns) == 0:
        raise HTTPException(status_code=400, detail="At least one turn is required.")
    if turns[-1].role != "user":
        raise HTTPException(status_code=400, detail="The last turn must be from the user.")
    for turn in turns:
        for image in turn.images:
            url = str(image.data_url or "").strip()
            if not url.startswith("data:image/"):
                raise HTTPException(
                    status_code=400,
                    detail="Each image must be a data:image/... base64 URL.",
                )
            if ";base64," not in url:
                raise HTTPException(
                    status_code=400, detail="Each image must be base64-encoded."
                )
            if len(url) > _MAX_IMAGE_DATA_URL_CHARS:
                raise HTTPException(status_code=400, detail="Image is too large.")
        if len(turn.images) > _MAX_IMAGES_PER_TURN:
            raise HTTPException(
                status_code=400,
                detail=f"At most {_MAX_IMAGES_PER_TURN} images per turn are allowed.",
            )
    return turns


def _image_content_items(images: list[ChatImageInput]) -> list[dict[str, Any]]:
    return [
        {"type": "image_url", "image_url": {"url": str(image.data_url).strip()}}
        for image in images
    ]


def _turn_content(turn: ChatTurnInput) -> str | list[dict[str, Any]]:
    """Build the pool content for one turn: plain text, or text + images."""
    text = str(turn.text or "")
    if not turn.images:
        return text
    content: list[dict[str, Any]] = []
    if text.strip():
        content.append({"type": "text", "text": text})
    content.extend(_image_content_items(turn.images))
    return content


def _multi_turn_messages(turns: list[ChatTurnInput]) -> list[dict[str, Any]]:
    return [{"role": turn.role, "content": _turn_content(turn)} for turn in turns]


def _flattened_transcript(turns: list[ChatTurnInput]) -> str:
    """Render the dialogue as a single role-labelled transcript (Route A)."""
    blocks: list[str] = []
    for turn in turns:
        label = "User" if turn.role == "user" else "Assistant"
        blocks.append(f"{label}: {str(turn.text or '').strip()}")
    return "\n\n".join(blocks)


def _flattened_input(turns: list[ChatTurnInput]) -> str | list[dict[str, Any]]:
    """Route A input: flattened transcript, with the last turn's images attached."""
    transcript = _flattened_transcript(turns)
    last_images = turns[-1].images if turns else []
    if not last_images:
        return transcript
    content: list[dict[str, Any]] = [{"type": "text", "text": transcript}]
    content.extend(_image_content_items(last_images))
    return content


def _decoding(request: ChatRunRequest) -> dict[str, Any]:
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


@router.post("/run", response_model=ChatRunResponse)
def run_chat(request: ChatRunRequest) -> ChatRunResponse:
    model = request.model.strip()
    if model == "":
        raise HTTPException(status_code=400, detail="Model must not be empty.")

    turns = _validate_turns(request.turns)
    effective_system_prompt = (
        request.system_prompt if str(request.system_prompt) != "" else " "
    )

    payload: dict[str, Any] = {
        "model": model,
        "instructions": effective_system_prompt,
        "allow_remote": request.allow_remote,
        "stream": False,
        "thinking": request.thinking,
        "decoding": _decoding(request),
    }
    if request.multi_turn:
        payload["messages"] = _multi_turn_messages(turns)
    else:
        payload["input"] = _flattened_input(turns)

    try:
        response_json, transport_completed_ms = _run_prompt_runner_payload(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    metrics = response_json.get("metrics", {})
    if not isinstance(metrics, dict):
        metrics = {}
    return ChatRunResponse(
        output_text=str(response_json.get("output_text") or ""),
        model=str(response_json.get("model") or model),
        request_id=str(response_json.get("id") or ""),
        multi_turn=request.multi_turn,
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
