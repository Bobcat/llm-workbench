from __future__ import annotations

import json
import time
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from app.llm_pool.models import _llm_pool_base_url


def _run_prompt_runner_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], float]:
    body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    req = urllib_request.Request(
        url=f"{_llm_pool_base_url()}/v1/responses",
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
