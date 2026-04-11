from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.smoke_runner import SmokeResult, run_smoke

router = APIRouter(prefix="/smoke", tags=["smoke"])


class SmokeRequest(BaseModel):
    path: str
    c_count: int = 10


class SmokeResponse(BaseModel):
    committed_events: int
    source_chars: int
    source_text: str
    target_text: str
    latency_ms: float

    @classmethod
    def from_result(cls, result: SmokeResult) -> "SmokeResponse":
        return cls(
            committed_events=result.committed_events,
            source_chars=result.source_chars,
            source_text=result.source_text,
            target_text=result.target_text,
            latency_ms=result.latency_ms,
        )


@router.post("", response_model=SmokeResponse)
def run_smoke_endpoint(request: SmokeRequest) -> SmokeResponse:
    """Run smoke test on first N committed chunks."""
    path = Path(request.path)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {request.path}")

    try:
        result = run_smoke(path, committed_events=request.c_count)
        return SmokeResponse.from_result(result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
