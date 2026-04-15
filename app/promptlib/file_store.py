from __future__ import annotations

import json
import os
import tempfile
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .models import PromptLoadIssue, PromptRecord, PromptWrite, normalize_prompt_id
from .store import (
    PromptConflictError,
    PromptLibraryStore,
    PromptNotFoundError,
    PromptValidationError,
)

SCHEMA_VERSION = 1
SYSTEM_PROMPT_FILE_NAME = "system.md"
USER_PROMPT_FILE_NAME = "user.md"
META_FILE_NAME = "meta.toml"
ALLOWED_TOP_LEVEL_KEYS = {
    "schema_version",
    "title",
    "editable",
    "enabled",
    "tags",
    "notes",
    "good_for",
    "sections",
}


class FilePromptLibraryStore(PromptLibraryStore):
    def __init__(self, root_dir: Path | str | None = None):
        self._root_dir = Path(root_dir) if root_dir is not None else _default_root_dir()
        self._root_dir.mkdir(parents=True, exist_ok=True)
        self._records: dict[str, PromptRecord] = {}
        self._load_issues: list[PromptLoadIssue] = []
        self.reload()

    @property
    def root_dir(self) -> Path:
        return self._root_dir

    def list_prompts(self, *, include_disabled: bool = True) -> list[PromptRecord]:
        prompts = sorted(self._records.values(), key=lambda prompt: prompt.id)
        if include_disabled:
            return prompts
        return [prompt for prompt in prompts if prompt.enabled]

    def get_prompt(self, prompt_id: str) -> PromptRecord:
        normalized_id = _normalize_or_raise(prompt_id)
        record = self._records.get(normalized_id)
        if record is None:
            raise PromptNotFoundError(f"Prompt not found: {normalized_id}")
        return record

    def create_prompt(self, prompt_id: str, data: PromptWrite) -> PromptRecord:
        normalized_id = _normalize_or_raise(prompt_id)
        entry_dir = self._entry_dir(normalized_id)
        if normalized_id in self._records or entry_dir.exists():
            raise PromptConflictError(f"Prompt already exists: {normalized_id}")

        normalized_write = _normalize_write(data)
        entry_dir.mkdir(parents=True, exist_ok=False)
        self._write_entry(entry_dir, normalized_write)
        record = self._load_prompt_record(entry_dir, normalized_id)
        self._records[normalized_id] = record
        return record

    def update_prompt(self, prompt_id: str, data: PromptWrite) -> PromptRecord:
        record = self.get_prompt(prompt_id)
        if not record.editable:
            raise PromptValidationError(f"Prompt is not editable: {record.id}")
        entry_dir = self._entry_dir(record.id)
        normalized_write = _normalize_write(data)
        self._write_entry(entry_dir, normalized_write)
        reloaded = self._load_prompt_record(entry_dir, record.id)
        self._records[record.id] = reloaded
        return reloaded

    def rename_prompt(self, prompt_id: str, new_prompt_id: str) -> PromptRecord:
        record = self.get_prompt(prompt_id)
        if not record.editable:
            raise PromptValidationError(f"Prompt is not editable: {record.id}")
        normalized_new_id = _normalize_or_raise(new_prompt_id)
        if normalized_new_id == record.id:
            return record

        old_dir = self._entry_dir(record.id)
        new_dir = self._entry_dir(normalized_new_id)
        if new_dir.exists() or normalized_new_id in self._records:
            raise PromptConflictError(f"Prompt already exists: {normalized_new_id}")
        if not old_dir.exists():
            raise PromptNotFoundError(f"Prompt directory not found: {record.id}")

        new_dir.parent.mkdir(parents=True, exist_ok=True)
        old_dir.rename(new_dir)
        del self._records[record.id]
        reloaded = self._load_prompt_record(new_dir, normalized_new_id)
        self._records[normalized_new_id] = reloaded
        return reloaded

    def duplicate_prompt(self, prompt_id: str, new_prompt_id: str) -> PromptRecord:
        source = self.get_prompt(prompt_id)
        return self.create_prompt(new_prompt_id, source.to_write())

    def archive_prompt(self, prompt_id: str) -> PromptRecord:
        record = self.get_prompt(prompt_id)
        if not record.editable:
            raise PromptValidationError(f"Prompt is not editable: {record.id}")
        if not record.enabled:
            return record
        data = record.to_write()
        data.enabled = False
        return self.update_prompt(record.id, data)

    def reload(self) -> None:
        self._root_dir.mkdir(parents=True, exist_ok=True)
        records: dict[str, PromptRecord] = {}
        issues: list[PromptLoadIssue] = []

        for entry_dir in sorted(
            (path for path in self._root_dir.rglob("*") if path.is_dir()),
            key=lambda path: str(path.relative_to(self._root_dir)),
        ):
            meta_path = entry_dir / META_FILE_NAME
            system_prompt_path = entry_dir / SYSTEM_PROMPT_FILE_NAME
            user_prompt_path = entry_dir / USER_PROMPT_FILE_NAME
            has_meta = meta_path.is_file()
            has_system_prompt = system_prompt_path.is_file()
            has_user_prompt = user_prompt_path.is_file()
            if not has_meta and not has_system_prompt and not has_user_prompt:
                continue

            prompt_id = _prompt_id_from_dir(self._root_dir, entry_dir)
            if not has_meta or not has_system_prompt or not has_user_prompt:
                issues.append(
                    PromptLoadIssue(
                        path=prompt_id,
                        message=(
                            f"Incomplete prompt entry. Expected {META_FILE_NAME}, "
                            f"{SYSTEM_PROMPT_FILE_NAME}, and {USER_PROMPT_FILE_NAME}."
                        ),
                    )
                )
                continue

            if any(child.is_dir() for child in entry_dir.iterdir()):
                issues.append(
                    PromptLoadIssue(
                        path=prompt_id,
                        message="Prompt entry directories must be leaf directories.",
                    )
                )
                continue

            try:
                records[prompt_id] = self._load_prompt_record(entry_dir, prompt_id)
            except PromptValidationError as exc:
                issues.append(PromptLoadIssue(path=prompt_id, message=str(exc)))

        self._records = records
        self._load_issues = issues

    def list_load_issues(self) -> list[PromptLoadIssue]:
        return list(self._load_issues)

    def _entry_dir(self, prompt_id: str) -> Path:
        normalized_id = _normalize_or_raise(prompt_id)
        entry_dir = self._root_dir.joinpath(*normalized_id.split("/"))
        root_resolved = self._root_dir.resolve()
        entry_resolved = entry_dir.resolve(strict=False)
        if not entry_resolved.is_relative_to(root_resolved):
            raise PromptValidationError(f"Prompt ID escapes prompt root: {normalized_id}")
        return entry_dir

    def _load_prompt_record(self, entry_dir: Path, prompt_id: str) -> PromptRecord:
        meta_path = entry_dir / META_FILE_NAME
        system_prompt_path = entry_dir / SYSTEM_PROMPT_FILE_NAME
        user_prompt_path = entry_dir / USER_PROMPT_FILE_NAME

        try:
            raw_meta = tomllib.loads(meta_path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as exc:
            raise PromptValidationError(f"Invalid TOML in {META_FILE_NAME}: {exc}") from exc
        except OSError as exc:
            raise PromptValidationError(f"Failed to read {META_FILE_NAME}: {exc}") from exc

        try:
            system_prompt = system_prompt_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise PromptValidationError(f"Failed to read {SYSTEM_PROMPT_FILE_NAME}: {exc}") from exc

        try:
            prompt_text = user_prompt_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise PromptValidationError(f"Failed to read {USER_PROMPT_FILE_NAME}: {exc}") from exc

        if not isinstance(raw_meta, dict):
            raise PromptValidationError(f"{META_FILE_NAME} must contain a TOML table.")

        unknown_keys = sorted(set(raw_meta) - ALLOWED_TOP_LEVEL_KEYS)
        if unknown_keys:
            raise PromptValidationError(
                f"Unknown top-level keys in {META_FILE_NAME}: {', '.join(unknown_keys)}"
            )

        schema_version = raw_meta.get("schema_version")
        if schema_version != SCHEMA_VERSION:
            raise PromptValidationError(
                f"Unsupported schema_version in {META_FILE_NAME}: {schema_version!r}"
            )

        title = raw_meta.get("title")
        if not isinstance(title, str) or not title.strip():
            raise PromptValidationError("Prompt title must be a non-empty string.")

        editable = raw_meta.get("editable", True)
        if not isinstance(editable, bool):
            raise PromptValidationError("Prompt editable flag must be a boolean.")

        enabled = raw_meta.get("enabled", True)
        if not isinstance(enabled, bool):
            raise PromptValidationError("Prompt enabled flag must be a boolean.")

        notes = raw_meta.get("notes", "")
        if not isinstance(notes, str):
            raise PromptValidationError("Prompt notes must be a string.")

        tags = _normalize_string_list(raw_meta.get("tags", []), field_name="tags")

        good_for = raw_meta.get("good_for", {})
        if good_for is None:
            good_for = {}
        if not isinstance(good_for, dict):
            raise PromptValidationError("[good_for] must be a table.")
        unknown_good_for = sorted(set(good_for) - {"models"})
        if unknown_good_for:
            raise PromptValidationError(
                f"Unknown keys in [good_for]: {', '.join(unknown_good_for)}"
            )
        good_for_models = _normalize_string_list(
            good_for.get("models", []),
            field_name="good_for.models",
        )

        sections = raw_meta.get("sections", {})
        if sections is None:
            sections = {}
        if not isinstance(sections, dict):
            raise PromptValidationError("[sections] must be a table.")
        normalized_sections = _normalize_sections(sections)

        return PromptRecord(
            id=prompt_id,
            title=title.strip(),
            prompt_text=prompt_text,
            system_prompt=system_prompt,
            editable=editable,
            enabled=enabled,
            tags=tags,
            notes=notes.strip(),
            good_for_models=good_for_models,
            sections=normalized_sections,
            schema_version=SCHEMA_VERSION,
        )

    def _write_entry(self, entry_dir: Path, data: PromptWrite) -> None:
        entry_dir.mkdir(parents=True, exist_ok=True)
        meta_path = entry_dir / META_FILE_NAME
        system_prompt_path = entry_dir / SYSTEM_PROMPT_FILE_NAME
        user_prompt_path = entry_dir / USER_PROMPT_FILE_NAME

        meta_text = _render_meta_toml(data)
        _write_text_atomic(meta_path, meta_text)
        _write_text_atomic(system_prompt_path, data.system_prompt)
        _write_text_atomic(user_prompt_path, data.prompt_text)


def _default_root_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "prompts"


def _normalize_or_raise(prompt_id: str) -> str:
    try:
        return normalize_prompt_id(prompt_id)
    except ValueError as exc:
        raise PromptValidationError(str(exc)) from exc


def _prompt_id_from_dir(root_dir: Path, entry_dir: Path) -> str:
    relative_path = entry_dir.relative_to(root_dir)
    return normalize_prompt_id(relative_path.as_posix())


def _normalize_write(data: PromptWrite) -> PromptWrite:
    if not isinstance(data, PromptWrite):
        raise PromptValidationError("Prompt payload must be a PromptWrite instance.")

    title = str(data.title or "").strip()
    if not title:
        raise PromptValidationError("Prompt title must not be empty.")

    if not isinstance(data.prompt_text, str):
        raise PromptValidationError("Prompt text must be a string.")

    if not isinstance(data.system_prompt, str):
        raise PromptValidationError("Prompt system_prompt must be a string.")

    if not isinstance(data.editable, bool):
        raise PromptValidationError("Prompt editable flag must be a boolean.")

    if not isinstance(data.enabled, bool):
        raise PromptValidationError("Prompt enabled flag must be a boolean.")

    tags = _normalize_string_list(data.tags, field_name="tags")
    good_for_models = _normalize_string_list(
        data.good_for_models,
        field_name="good_for.models",
    )
    notes = str(data.notes or "").strip()
    sections = _normalize_sections(data.sections)

    return PromptWrite(
        title=title,
        prompt_text=data.prompt_text,
        system_prompt=data.system_prompt,
        editable=data.editable,
        enabled=data.enabled,
        tags=tags,
        notes=notes,
        good_for_models=good_for_models,
        sections=sections,
    )


def _normalize_string_list(value: Any, *, field_name: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise PromptValidationError(f"{field_name} must be a list of strings.")

    normalized: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise PromptValidationError(f"{field_name} must be a list of strings.")
        cleaned = item.strip()
        if not cleaned or cleaned in normalized:
            continue
        normalized.append(cleaned)
    return normalized


def _normalize_sections(value: Any) -> dict[str, dict[str, Any]]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise PromptValidationError("[sections] must be a table.")

    normalized: dict[str, dict[str, Any]] = {}
    for section_name, section_value in value.items():
        if not isinstance(section_name, str) or not section_name.strip():
            raise PromptValidationError("Section names must be non-empty strings.")
        if not isinstance(section_value, dict):
            raise PromptValidationError(
                f"Section {section_name!r} must be a table."
            )
        normalized_section_name = section_name.strip()
        normalized[normalized_section_name] = _normalize_nested_table(
            section_value,
            context=f"sections.{normalized_section_name}",
        )
    return normalized


def _normalize_nested_table(value: Mapping[str, Any], *, context: str) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, item in value.items():
        if not isinstance(key, str) or not key.strip():
            raise PromptValidationError(f"{context} contains an invalid key.")
        normalized_key = key.strip()
        if isinstance(item, dict):
            normalized[normalized_key] = _normalize_nested_table(
                item,
                context=f"{context}.{normalized_key}",
            )
            continue
        _ensure_supported_value(item, context=f"{context}.{normalized_key}")
        normalized[normalized_key] = item
    return normalized


def _ensure_supported_value(value: Any, *, context: str) -> None:
    if isinstance(value, (str, bool, int, float)):
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            if isinstance(item, dict):
                raise PromptValidationError(f"{context}[{index}] must not contain inline tables.")
            _ensure_supported_value(item, context=f"{context}[{index}]")
        return
    raise PromptValidationError(f"{context} contains an unsupported value type: {type(value).__name__}")


def _render_meta_toml(data: PromptWrite) -> str:
    lines = [
        f"schema_version = {SCHEMA_VERSION}",
        f"title = {json.dumps(data.title)}",
        f"editable = {'true' if data.editable else 'false'}",
        f"enabled = {'true' if data.enabled else 'false'}",
        f"tags = {json.dumps(data.tags)}",
        f"notes = {json.dumps(data.notes)}",
    ]

    if data.good_for_models:
        lines.extend(
            [
                "",
                "[good_for]",
                f"models = {json.dumps(data.good_for_models)}",
            ]
        )

    if data.sections:
        _append_toml_tables(lines, ["sections"], data.sections)

    return "\n".join(lines) + "\n"


def _append_toml_tables(lines: list[str], path_parts: list[str], table: Mapping[str, Any]) -> None:
    scalar_items: list[tuple[str, Any]] = []
    nested_items: list[tuple[str, Mapping[str, Any]]] = []

    for key, value in table.items():
        if isinstance(value, Mapping):
            nested_items.append((key, value))
        else:
            scalar_items.append((key, value))

    if scalar_items:
        lines.append("")
        lines.append(_table_header(path_parts))
        for key, value in scalar_items:
            lines.append(f"{key} = {_render_toml_value(value)}")

    for key, value in nested_items:
        _append_toml_tables(lines, [*path_parts, key], value)


def _table_header(path_parts: list[str]) -> str:
    return "[" + ".".join(path_parts) + "]"


def _render_toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, list):
        return "[" + ", ".join(_render_toml_value(item) for item in value) + "]"
    raise PromptValidationError(f"Unsupported value for TOML rendering: {type(value).__name__}")


def _write_text_atomic(path: Path, content: str) -> None:
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(content)
            temp_path = Path(handle.name)
        os.replace(temp_path, path)
    except OSError as exc:
        raise PromptValidationError(f"Failed to write {path.name}: {exc}") from exc
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink(missing_ok=True)
