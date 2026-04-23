from __future__ import annotations

from typing import TYPE_CHECKING

from promptlib import FilePromptLibraryStore, PromptNotFoundError, PromptRecord

from app.realtime_translation.replay.settings import PROMPT_LIBRARY_ROOT

if TYPE_CHECKING:
    from app.realtime_translation.replay.sessions import ReplaySession


_prompt_store = FilePromptLibraryStore(PROMPT_LIBRARY_ROOT)


def _is_translation_stage_prompt(record: PromptRecord, stage_name: str) -> bool:
    translation_section = record.sections.get("translation", {})
    if not isinstance(translation_section, dict):
        return False
    stage = str(translation_section.get("stage", "")).strip().lower()
    return stage == str(stage_name or "").strip().lower()


def _load_stage_prompt(prompt_id: str, *, stage_name: str) -> PromptRecord:
    _prompt_store.reload()
    try:
        record = _prompt_store.get_prompt(prompt_id)
    except PromptNotFoundError as exc:
        raise ValueError(str(exc)) from exc
    if not record.enabled:
        raise ValueError(f"Prompt {prompt_id!r} is disabled.")
    if not _is_translation_stage_prompt(record, stage_name):
        raise ValueError(f"Prompt {prompt_id!r} is not a {stage_name.replace('_', '-')} translation prompt.")
    return record


def _load_first_pass_prompt(prompt_id: str) -> PromptRecord:
    return _load_stage_prompt(prompt_id, stage_name="first_pass")


def _load_second_pass_prompt(prompt_id: str) -> PromptRecord:
    return _load_stage_prompt(prompt_id, stage_name="second_pass")


def _apply_first_pass_prompt(session: ReplaySession, prompt: PromptRecord) -> None:
    session.first_pass_prompt_id = prompt.id
    session.first_pass_system_prompt = prompt.system_prompt
    session.first_pass_user_prompt = prompt.prompt_text


def _apply_second_pass_prompt(session: ReplaySession, prompt: PromptRecord) -> None:
    session.second_pass_prompt_id = prompt.id
    session.second_pass_system_prompt = prompt.system_prompt
    session.second_pass_user_prompt = prompt.prompt_text
