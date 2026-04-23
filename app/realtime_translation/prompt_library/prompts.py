from __future__ import annotations

from copy import deepcopy
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from promptlib import (
    FilePromptLibraryStore,
    PromptConflictError,
    PromptLoadIssue,
    PromptNotFoundError,
    PromptRecord,
    PromptValidationError,
    PromptWrite,
)
from app.realtime_translation.replay.settings import PROMPT_LIBRARY_ROOT
from realtime_translation_engine.translators import LlmResponsesTranslator
from realtime_translation_engine.translators import render_translation_template

router = APIRouter(prefix="/prompts", tags=["prompts"])

_store = FilePromptLibraryStore(PROMPT_LIBRARY_ROOT)


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
    draft_translation: str = ""
    source_language: str = "English"
    target_language: str = "Dutch"


class PromptTestResponse(BaseModel):
    output_text: str
    model: str
    request_id: str
    rendered_user_prompt: str
    metrics: dict[str, float | int | None] = Field(default_factory=dict)


def _get_store() -> FilePromptLibraryStore:
    return _store


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


def _raise_http_for_store_error(exc: Exception) -> None:
    if isinstance(exc, PromptNotFoundError):
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if isinstance(exc, PromptConflictError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if isinstance(exc, PromptValidationError):
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise HTTPException(status_code=500, detail=str(exc)) from exc


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
