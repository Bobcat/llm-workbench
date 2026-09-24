from __future__ import annotations

import http.client
import json
from typing import TYPE_CHECKING
from urllib import error, parse, request

from promptlib import PromptRecord

from app.translation_services.proxy import _base_url

if TYPE_CHECKING:
    from app.realtime_translation.replay.sessions import ReplaySession


class PromptLoadError(ValueError):
    """A prompt could not be fetched from translation-services.

    ``status_code`` is the HTTP status the API answers with: 404 when the
    library does not have the prompt, 502 when the service itself failed.
    """

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


# Prompts live in the translation-services library (/v1/prompts), one flat list shared
# with the image pipeline. A prompt has no first/second-pass property of its own — which
# slot it serves is the caller's choice. The engine still receives plain prompt strings;
# we fetch the {system, user} entry here and map it onto a PromptRecord.
def _load_prompt(prompt_id: str) -> PromptRecord:
    # quote(safe="") matters: prompt_id comes straight from the client, and without it an id like
    # "../../v1/models" would address another upstream endpoint instead of a prompt.
    safe_id = parse.quote(str(prompt_id or ""), safe="")
    url = f"{_base_url()}/v1/prompts/{safe_id}"
    req = request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with request.urlopen(req, timeout=5.0) as response:
            body = response.read()
    except error.HTTPError as exc:
        if exc.code == 404:
            raise PromptLoadError(
                f"Prompt {prompt_id!r} not found in translation-services.", 404
            ) from exc
        raise PromptLoadError(f"translation-services /v1/prompts HTTP {exc.code}", 502) from exc
    except (error.URLError, TimeoutError) as exc:
        raise PromptLoadError(f"translation-services unreachable: {exc}", 502) from exc
    except (OSError, http.client.HTTPException) as exc:
        # The connection was accepted and then broke while the body came in: a reset, a service
        # restarting mid-answer, a proxy closing early (`IncompleteRead`). None of those are a
        # URLError, and without this they reach the client as a 500 for the other side's problem.
        raise PromptLoadError(f"translation-services broke off the answer: {exc}", 502) from exc

    # The service answered, so a body we cannot read is its failure, not ours: a proxy in front of
    # it, or a wrong port hitting another service, answers with HTML. Without this the decode error
    # reaches the client as a 500, which blames the workbench for a problem on the other side.
    try:
        data = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise PromptLoadError(f"translation-services sent an unreadable answer: {exc}", 502) from exc
    if not isinstance(data, dict):
        raise PromptLoadError(
            f"translation-services sent {type(data).__name__} instead of a prompt", 502
        )

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
