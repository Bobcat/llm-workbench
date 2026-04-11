from __future__ import annotations

from fastapi import APIRouter
from urllib import error, request
import json
import os

router = APIRouter(prefix="/models", tags=["models"])

DEFAULT_LLM_RESPONSES_API_BASE_URL = os.environ.get(
    "LLM_RESPONSES_API_BASE_URL", "http://127.0.0.1:8011"
)


@router.get("")
def list_models() -> list[dict[str, str]]:
    """Get available models from llm-pool service."""
    try:
        req = request.Request(
            url=f"{DEFAULT_LLM_RESPONSES_API_BASE_URL.rstrip('/')}/v1/models",
            method="GET",
            headers={"Accept": "application/json"},
        )
        with request.urlopen(req, timeout=2.0) as response:
            data = json.loads(response.read().decode("utf-8"))
            models = data.get("models", [])
            return [{"id": m, "name": m} for m in models]
    except (error.URLError, error.HTTPError, TimeoutError):
        return []
