from __future__ import annotations

import json
import time
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from realtime_translation_engine.translators import DEFAULT_LLM_RESPONSES_API_BASE_URL

router = APIRouter(prefix="/prompts", tags=["prompts"])


class PromptRunFile(BaseModel):
    name: str
    content: str = ""


class PromptRunRequest(BaseModel):
    model: str
    system_prompt: str = ""
    user_prompt: str = ""
    files: list[PromptRunFile] = Field(default_factory=list)


class PromptRunResponse(BaseModel):
    output_text: str
    model: str
    request_id: str
    rendered_user_prompt: str
    metrics: dict[str, float | int | None] = Field(default_factory=dict)


def _render_user_prompt_with_attachments(
    user_prompt: str,
    *,
    files: list[PromptRunFile],
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


def _prompt_runner_payload(*, model: str, system_prompt: str, rendered_user_prompt: str) -> dict[str, Any]:
    effective_system_prompt = system_prompt if str(system_prompt) != "" else " "
    return {
        "model": model,
        "input": rendered_user_prompt,
        "instructions": effective_system_prompt,
        "stream": False,
        "decoding": {
            "max_tokens": 2048,
            "temperature": 0.01,
            "top_p": 1,
            "top_k": 1,
            "repetition_penalty": 1,
        },
    }


def _run_prompt_runner_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], float]:
    body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    req = urllib_request.Request(
        url=f"{DEFAULT_LLM_RESPONSES_API_BASE_URL.rstrip('/')}/v1/responses",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib_request.urlopen(req, timeout=120.0) as response:
            raw = response.read()
    except urllib_error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"llm-responses API HTTP {exc.code}: {detail.strip() or exc.reason}"
        ) from exc
    except urllib_error.URLError as exc:
        raise RuntimeError(f"llm-responses API unavailable: {exc.reason}") from exc

    parsed = json.loads(raw.decode("utf-8", errors="replace"))
    if not isinstance(parsed, dict):
        raise RuntimeError("llm-responses API returned invalid JSON object")
    completed_ms = (time.perf_counter() - started) * 1000.0
    return parsed, completed_ms


@router.post("/run", response_model=PromptRunResponse)
def run_prompt(request: PromptRunRequest) -> PromptRunResponse:
    model = request.model.strip()
    if model == "":
        raise HTTPException(status_code=400, detail="Model must not be empty.")

    rendered_user_prompt = _render_user_prompt_with_attachments(
        request.user_prompt,
        files=request.files,
    )
    if rendered_user_prompt.strip() == "":
        raise HTTPException(status_code=400, detail="Rendered user prompt must not be empty.")

    try:
        response_json, transport_completed_ms = _run_prompt_runner_payload(
            _prompt_runner_payload(
                model=model,
                system_prompt=request.system_prompt,
                rendered_user_prompt=rendered_user_prompt,
            )
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    metrics = response_json.get("metrics", {})
    if not isinstance(metrics, dict):
        metrics = {}
    return PromptRunResponse(
        output_text=str(response_json.get("output_text") or ""),
        model=str(response_json.get("model") or model),
        request_id=str(response_json.get("id") or ""),
        rendered_user_prompt=rendered_user_prompt,
        metrics={
            "transport_first_byte_ms": None,
            "transport_first_text_delta_ms": None,
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
