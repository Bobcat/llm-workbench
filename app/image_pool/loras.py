from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter

router = APIRouter(prefix="/image-pool/loras", tags=["image-pool-loras"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TRAINING_RUNS_ROOT = PROJECT_ROOT / "data" / "image_pool" / "training" / "flux2-klein" / "runs"
LORA_WEIGHT_NAME = "pytorch_lora_weights.safetensors"
CHECKPOINT_STEP_RE = re.compile(r"^step-(\d+)$")


@router.get("")
def list_loras() -> dict[str, list[dict[str, object]]]:
    return {"loras": _lora_payloads()}


def _lora_payloads() -> list[dict[str, object]]:
    if not TRAINING_RUNS_ROOT.exists():
        return []

    loras: list[dict[str, object]] = []
    for run_dir in sorted((item for item in TRAINING_RUNS_ROOT.iterdir() if item.is_dir()), reverse=True):
        request_payload = _read_request_payload(run_dir / "request.json")
        model = str(request_payload.get("model") or "").strip()
        metadata = request_payload.get("metadata")
        dataset = ""
        if isinstance(metadata, dict):
            dataset = str(metadata.get("dataset") or "").strip()
        run_id = run_dir.name
        weight_path = run_dir / LORA_WEIGHT_NAME
        if weight_path.is_file():
            loras.append(_lora_payload(weight_path, run_id=run_id, dataset=dataset, model=model))
        for checkpoint_dir in _checkpoint_dirs(run_dir):
            checkpoint_weight_path = checkpoint_dir / LORA_WEIGHT_NAME
            if checkpoint_weight_path.is_file():
                loras.append(
                    _lora_payload(
                        checkpoint_weight_path,
                        run_id=run_id,
                        dataset=dataset,
                        model=model,
                        checkpoint_id=checkpoint_dir.name,
                    )
                )
    return loras


def _lora_payload(
    weight_path: Path,
    *,
    run_id: str,
    dataset: str,
    model: str,
    checkpoint_id: str = "",
) -> dict[str, object]:
    checkpoint_step = _checkpoint_step(checkpoint_id)
    checkpoint_label = f" / step {checkpoint_step}" if checkpoint_step is not None else ""
    id_suffix = f"/{checkpoint_id}" if checkpoint_id else ""
    return {
        "id": f"flux2-klein/{dataset or 'dataset'}/{run_id}{id_suffix}",
        "name": f"{dataset or 'LoRA'} / {run_id}{checkpoint_label}",
        "run_id": run_id,
        "dataset": dataset,
        "model": model,
        "compatible_models": _compatible_models(model),
        "path": str(weight_path.resolve()),
        "display_path": _display_path(weight_path),
        "size_bytes": weight_path.stat().st_size,
        "kind": "checkpoint" if checkpoint_id else "final",
        "checkpoint_id": checkpoint_id,
        "checkpoint_step": checkpoint_step,
    }


def _checkpoint_dirs(run_dir: Path) -> list[Path]:
    checkpoints_dir = run_dir / "checkpoints"
    if not checkpoints_dir.is_dir():
        return []
    return sorted(
        (item for item in checkpoints_dir.iterdir() if item.is_dir()),
        key=lambda item: _checkpoint_step(item.name) or -1,
        reverse=True,
    )


def _checkpoint_step(checkpoint_id: str) -> int | None:
    match = CHECKPOINT_STEP_RE.match(checkpoint_id)
    return int(match.group(1)) if match else None


def _compatible_models(model: str) -> list[str]:
    model_id = str(model or "").strip()
    if model_id == "flux2-klein-base-4b":
        return ["flux2-klein-base-4b", "flux2-klein-4b"]
    if model_id == "flux2-klein-base-9b":
        return ["flux2-klein-base-9b", "flux2-klein-9b"]
    return [model_id] if model_id else []


def _read_request_payload(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)
