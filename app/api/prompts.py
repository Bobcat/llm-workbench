from __future__ import annotations

from copy import deepcopy
import json
import time
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.promptlib import (
    FilePromptLibraryStore,
    PromptConflictError,
    PromptLoadIssue,
    PromptNotFoundError,
    PromptRecord,
    PromptValidationError,
    PromptWrite,
)
from app.translators import DEFAULT_LLM_RESPONSES_API_BASE_URL, LlmResponsesTranslator

router = APIRouter(prefix="/prompts", tags=["prompts"])

_store = FilePromptLibraryStore()


class PromptPayload(BaseModel):
    title: str
    prompt_text: str
    system_prompt: str = ""
    editable: bool = True
    enabled: bool = True
    tags: list[str] = Field(default_factory=list)
    notes: str = ""
    good_for_models: list[str] = Field(default_factory=list)
    sections: dict[str, dict[str, Any]] = Field(default_factory=dict)

    def to_write(self) -> PromptWrite:
        return PromptWrite(
            title=self.title,
            prompt_text=self.prompt_text,
            system_prompt=self.system_prompt,
            editable=self.editable,
            enabled=self.enabled,
            tags=list(self.tags),
            notes=self.notes,
            good_for_models=list(self.good_for_models),
            sections=deepcopy(self.sections),
        )


class CreatePromptRequest(PromptPayload):
    prompt_id: str


class RenamePromptRequest(BaseModel):
    prompt_id: str
    new_prompt_id: str


class DuplicatePromptRequest(BaseModel):
    prompt_id: str
    new_prompt_id: str


class ArchivePromptRequest(BaseModel):
    prompt_id: str


class PromptResponse(PromptPayload):
    id: str
    schema_version: int

    @classmethod
    def from_record(cls, record: PromptRecord) -> "PromptResponse":
        return cls(
            id=record.id,
            title=record.title,
            prompt_text=record.prompt_text,
            system_prompt=record.system_prompt,
            editable=record.editable,
            enabled=record.enabled,
            tags=list(record.tags),
            notes=record.notes,
            good_for_models=list(record.good_for_models),
            sections=deepcopy(record.sections),
            schema_version=record.schema_version,
        )


class PromptLoadIssueResponse(BaseModel):
    path: str
    message: str

    @classmethod
    def from_issue(cls, issue: PromptLoadIssue) -> "PromptLoadIssueResponse":
        return cls(path=issue.path, message=issue.message)


class PromptTestRequest(BaseModel):
    model: str
    system_prompt: str = ""
    user_prompt_template: str
    source_text: str = ""


class PromptRunFile(BaseModel):
    name: str
    content: str = ""


class PromptRunRequest(BaseModel):
    model: str
    system_prompt: str = ""
    user_prompt: str = ""
    files: list[PromptRunFile] = Field(default_factory=list)


class PromptTestResponse(BaseModel):
    output_text: str
    model: str
    request_id: str
    rendered_user_prompt: str
    metrics: dict[str, float | int | None] = Field(default_factory=dict)


def _get_store() -> FilePromptLibraryStore:
    return _store


def _render_user_prompt_template(template: str, *, source_text: str) -> str:
    return str(template or "").replace("{{source_window}}", str(source_text or ""))


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


def _raise_http_for_store_error(exc: Exception) -> None:
    if isinstance(exc, PromptNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, PromptConflictError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, PromptValidationError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise HTTPException(status_code=500, detail=str(exc)) from exc


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


@router.get("", response_model=list[PromptResponse])
def list_prompts(include_disabled: bool = Query(True)) -> list[PromptResponse]:
    store = _get_store()
    store.reload()
    return [
        PromptResponse.from_record(record)
        for record in store.list_prompts(include_disabled=include_disabled)
    ]


@router.get("/load-issues", response_model=list[PromptLoadIssueResponse])
def list_prompt_load_issues() -> list[PromptLoadIssueResponse]:
    store = _get_store()
    store.reload()
    return [
        PromptLoadIssueResponse.from_issue(issue)
        for issue in store.list_load_issues()
    ]


@router.post("", response_model=PromptResponse)
def create_prompt(request: CreatePromptRequest) -> PromptResponse:
    store = _get_store()
    try:
        record = store.create_prompt(request.prompt_id, request.to_write())
    except Exception as exc:
        _raise_http_for_store_error(exc)
    return PromptResponse.from_record(record)


@router.post("/rename", response_model=PromptResponse)
def rename_prompt(request: RenamePromptRequest) -> PromptResponse:
    store = _get_store()
    try:
        record = store.rename_prompt(request.prompt_id, request.new_prompt_id)
    except Exception as exc:
        _raise_http_for_store_error(exc)
    return PromptResponse.from_record(record)


@router.post("/duplicate", response_model=PromptResponse)
def duplicate_prompt(request: DuplicatePromptRequest) -> PromptResponse:
    store = _get_store()
    try:
        record = store.duplicate_prompt(request.prompt_id, request.new_prompt_id)
    except Exception as exc:
        _raise_http_for_store_error(exc)
    return PromptResponse.from_record(record)


@router.post("/archive", response_model=PromptResponse)
def archive_prompt(request: ArchivePromptRequest) -> PromptResponse:
    store = _get_store()
    try:
        record = store.archive_prompt(request.prompt_id)
    except Exception as exc:
        _raise_http_for_store_error(exc)
    return PromptResponse.from_record(record)


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
        correction_model=model,
    )
    rendered_user_prompt = _render_user_prompt_template(
        user_prompt_template,
        source_text=request.source_text,
    )
    if rendered_user_prompt.strip() == "":
        raise HTTPException(status_code=400, detail="Rendered user prompt must not be empty.")

    try:
        result = translator.translate_with_system_prompt(
            rendered_user_prompt,
            system_prompt=system_prompt,
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


@router.post("/run", response_model=PromptTestResponse)
def run_prompt(request: PromptRunRequest) -> PromptTestResponse:
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
    return PromptTestResponse(
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


@router.get("/{prompt_id:path}", response_model=PromptResponse)
def get_prompt(prompt_id: str) -> PromptResponse:
    store = _get_store()
    store.reload()
    try:
        record = store.get_prompt(prompt_id)
    except Exception as exc:
        _raise_http_for_store_error(exc)
    return PromptResponse.from_record(record)


@router.put("/{prompt_id:path}", response_model=PromptResponse)
def update_prompt(prompt_id: str, request: PromptPayload) -> PromptResponse:
    store = _get_store()
    try:
        record = store.update_prompt(prompt_id, request.to_write())
    except Exception as exc:
        _raise_http_for_store_error(exc)
    return PromptResponse.from_record(record)
