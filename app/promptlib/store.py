from __future__ import annotations

from abc import ABC, abstractmethod

from .models import PromptLoadIssue, PromptRecord, PromptWrite


class PromptLibraryError(Exception):
    pass


class PromptValidationError(PromptLibraryError):
    pass


class PromptNotFoundError(PromptLibraryError):
    pass


class PromptConflictError(PromptLibraryError):
    pass


class PromptLibraryStore(ABC):
    @abstractmethod
    def list_prompts(self, *, include_disabled: bool = True) -> list[PromptRecord]:
        raise NotImplementedError

    @abstractmethod
    def get_prompt(self, prompt_id: str) -> PromptRecord:
        raise NotImplementedError

    @abstractmethod
    def create_prompt(self, prompt_id: str, data: PromptWrite) -> PromptRecord:
        raise NotImplementedError

    @abstractmethod
    def update_prompt(self, prompt_id: str, data: PromptWrite) -> PromptRecord:
        raise NotImplementedError

    @abstractmethod
    def rename_prompt(self, prompt_id: str, new_prompt_id: str) -> PromptRecord:
        raise NotImplementedError

    @abstractmethod
    def duplicate_prompt(self, prompt_id: str, new_prompt_id: str) -> PromptRecord:
        raise NotImplementedError

    @abstractmethod
    def archive_prompt(self, prompt_id: str) -> PromptRecord:
        raise NotImplementedError

    @abstractmethod
    def reload(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def list_load_issues(self) -> list[PromptLoadIssue]:
        raise NotImplementedError
