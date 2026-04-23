from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any


@dataclass(slots=True)
class PromptWrite:
    title: str
    prompt_text: str
    system_prompt: str = ""
    editable: bool = True
    enabled: bool = True
    tags: list[str] = field(default_factory=list)
    notes: str = ""
    good_for_models: list[str] = field(default_factory=list)
    sections: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass(slots=True)
class PromptRecord:
    id: str
    title: str
    prompt_text: str
    system_prompt: str = ""
    editable: bool = True
    enabled: bool = True
    tags: list[str] = field(default_factory=list)
    notes: str = ""
    good_for_models: list[str] = field(default_factory=list)
    sections: dict[str, dict[str, Any]] = field(default_factory=dict)
    schema_version: int = 1

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


@dataclass(slots=True)
class PromptLoadIssue:
    path: str
    message: str


def normalize_prompt_id(prompt_id: str) -> str:
    raw = str(prompt_id or "").replace("\\", "/").strip().strip("/")
    if not raw:
        raise ValueError("Prompt ID must not be empty.")

    path = PurePosixPath(raw)
    parts = path.parts
    if not parts:
        raise ValueError("Prompt ID must not be empty.")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError(f"Invalid prompt ID: {prompt_id!r}")
    return "/".join(parts)
