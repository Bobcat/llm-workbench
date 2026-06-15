from __future__ import annotations

import json
from typing import TYPE_CHECKING
from urllib import error, parse, request

from promptlib import PromptRecord

from app.translation_services.proxy import _base_url

if TYPE_CHECKING:
    from app.realtime_translation.replay.sessions import ReplaySession


# Prompts live in the translation-services library (/v1/prompts), one flat list shared
# with the image pipeline. A prompt has no first/second-pass property of its own — which
# slot it serves is the caller's choice. The engine still receives plain prompt strings;
# we fetch the {system, user} entry here and map it onto a PromptRecord.
def _load_prompt(prompt_id: str) -> PromptRecord:
    safe_id = parse.quote(str(prompt_id or ""), safe="")
    url = f"{_base_url()}/v1/prompts/{safe_id}"
    req = request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with request.urlopen(req, timeout=5.0) as response:
            data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        if exc.code == 404:
            raise ValueError(f"Prompt {prompt_id!r} not found in translation-services.") from exc
        raise ValueError(f"translation-services /v1/prompts HTTP {exc.code}") from exc
    except (error.URLError, TimeoutError) as exc:
        raise ValueError(f"translation-services unreachable: {exc}") from exc
    return PromptRecord(
        id=str(data.get("id") or prompt_id),
        title=str(data.get("title") or ""),
        prompt_text=str(data.get("user") or ""),
        system_prompt=str(data.get("system") or ""),
    )


def _load_first_pass_prompt(prompt_id: str) -> PromptRecord:
    return _load_prompt(prompt_id)


def _load_second_pass_prompt(prompt_id: str) -> PromptRecord:
    return _load_prompt(prompt_id)


def _apply_first_pass_prompt(session: ReplaySession, prompt: PromptRecord) -> None:
    session.first_pass_prompt_id = prompt.id
    session.first_pass_system_prompt = prompt.system_prompt
    session.first_pass_user_prompt = prompt.prompt_text


def _apply_second_pass_prompt(session: ReplaySession, prompt: PromptRecord) -> None:
    session.second_pass_prompt_id = prompt.id
    session.second_pass_system_prompt = prompt.system_prompt
    session.second_pass_user_prompt = prompt.prompt_text
