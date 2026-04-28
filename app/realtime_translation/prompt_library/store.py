from __future__ import annotations

from functools import cache

from promptlib import FilePromptLibraryStore

from app.realtime_translation.replay.settings import PROMPT_LIBRARY_ROOT


@cache
def get_prompt_library_store() -> FilePromptLibraryStore:
    return FilePromptLibraryStore(PROMPT_LIBRARY_ROOT)
