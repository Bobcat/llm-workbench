from __future__ import annotations

import json
import math
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, File, HTTPException, UploadFile

from app.image_pool.models import _request_json as _request_image_pool_json

router = APIRouter(prefix="/image-pool/loras", tags=["image-pool-loras"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TRAINING_RUNS_ROOT = PROJECT_ROOT / "data" / "image_pool" / "training" / "flux2-klein" / "runs"
Z_IMAGE_TRAINING_RUNS_ROOT = PROJECT_ROOT / "data" / "image_pool" / "training" / "z-image" / "runs"
IMPORTED_LORAS_ROOT = PROJECT_ROOT / "data" / "image_pool" / "loras" / "imported"
LORA_IMPORT_UPLOADS_ROOT = PROJECT_ROOT / "tmp" / "image_pool" / "lora_imports"
LORA_WEIGHT_NAME = "pytorch_lora_weights.safetensors"
IMPORTED_LORA_WEIGHT_NAMES = ("adapter.safetensors", LORA_WEIGHT_NAME)
CHECKPOINT_STEP_RE = re.compile(r"^step-(\d+)$")


@router.get("")
def list_loras() -> dict[str, list[dict[str, object]]]:
    return {"loras": _lora_payloads()}


@router.post("/inspect")
async def inspect_lora(file: UploadFile = File(...)) -> dict[str, object]:
    filename = _safe_upload_filename(file.filename or "lora.safetensors")
    if Path(filename).suffix.lower() != ".safetensors":
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_lora_file", "message": "LoRA file must be a .safetensors file."},
        )

    upload_id = uuid.uuid4().hex
    upload_dir = LORA_IMPORT_UPLOADS_ROOT / upload_id
    upload_dir.mkdir(parents=True, exist_ok=False)
    upload_path = upload_dir / filename
    with upload_path.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)

    payload = _request_image_pool_json(
        method="POST",
        path="/v1/admin/loras/inspect",
        payload={"source_path": str(upload_path.resolve())},
        timeout=60.0,
    )
    payload["upload_id"] = upload_id
    payload["filename"] = filename
    return payload


@router.post("/import")
def import_lora(payload: dict[str, object] = Body(default_factory=dict)) -> dict:
    upload_id = str(payload.get("upload_id") or "").strip()
    source_path = _uploaded_lora_path(upload_id)
    forwarded = {
        "source_path": str(source_path),
        "name": str(payload.get("name") or "").strip(),
        "family": str(payload.get("family") or "").strip(),
        "compatible_models": _string_list(payload.get("compatible_models")),
        "trained_on_model_id": str(payload.get("trained_on_model_id") or "").strip(),
        "trigger_words": _string_list(payload.get("trigger_words")),
        "default_strength": payload.get("default_strength"),
        "description": str(payload.get("description") or "").strip(),
        "source_url": str(payload.get("source_url") or "").strip(),
    }
    response = _request_image_pool_json(
        method="POST",
        path="/v1/admin/loras/import",
        payload=forwarded,
        timeout=120.0,
    )
    shutil.rmtree(source_path.parent, ignore_errors=True)
    return response


def _lora_payloads() -> list[dict[str, object]]:
    loras: list[dict[str, object]] = []
    for family, root in (("flux2-klein", TRAINING_RUNS_ROOT), ("z-image", Z_IMAGE_TRAINING_RUNS_ROOT)):
        if not root.exists():
            continue
        for run_dir in sorted((item for item in root.iterdir() if item.is_dir()), reverse=True):
            request_payload = _read_request_payload(run_dir / "request.json")
            model = str(request_payload.get("model") or "").strip()
            metadata = request_payload.get("metadata")
            dataset = ""
            if isinstance(metadata, dict):
                dataset = str(metadata.get("dataset") or "").strip()
            run_id = run_dir.name
            weight_path = run_dir / LORA_WEIGHT_NAME
            if weight_path.is_file():
                loras.append(
                    _training_lora_payload(
                        weight_path,
                        family=family,
                        run_id=run_id,
                        dataset=dataset,
                        model=model,
                        request_payload=request_payload,
                    )
                )
            for checkpoint_dir in _checkpoint_dirs(run_dir):
                checkpoint_weight_path = checkpoint_dir / LORA_WEIGHT_NAME
                if checkpoint_weight_path.is_file():
                    loras.append(
                        _training_lora_payload(
                            checkpoint_weight_path,
                            family=family,
                            run_id=run_id,
                            dataset=dataset,
                            model=model,
                            request_payload=request_payload,
                            checkpoint_id=checkpoint_dir.name,
                        )
                    )
    loras.extend(_imported_lora_payloads())
    loras.extend(_image_pool_imported_lora_payloads())
    return loras


def _training_lora_payload(
    weight_path: Path,
    *,
    family: str,
    run_id: str,
    dataset: str,
    model: str,
    request_payload: dict[str, Any],
    checkpoint_id: str = "",
) -> dict[str, object]:
    checkpoint_step = _checkpoint_step(checkpoint_id)
    checkpoint_label = f" / step {checkpoint_step}" if checkpoint_step is not None else ""
    id_suffix = f"/{checkpoint_id}" if checkpoint_id else ""
    artifact_type = "checkpoint" if checkpoint_id else "final"
    trigger_words = _string_list(request_payload.get("trigger_words")) or _string_list(request_payload.get("trigger_word"))
    metadata = request_payload.get("metadata")
    metadata_payload = metadata if isinstance(metadata, dict) else {}
    description = str(metadata_payload.get("description") or "").strip()
    default_strength = _float_or_none(metadata_payload.get("default_strength"))
    return {
        "id": f"{family}/{dataset or 'dataset'}/{run_id}{id_suffix}",
        "name": f"{dataset or 'LoRA'} / {run_id}{checkpoint_label}",
        "family": family,
        "source_type": "training_run",
        "artifact_type": artifact_type,
        "run_id": run_id,
        "dataset": dataset,
        "trained_on_model_id": model,
        "model": model,
        "compatible_models": _compatible_models(model),
        "trigger_words": trigger_words,
        "trigger_word": trigger_words[0] if trigger_words else "",
        "default_strength": default_strength,
        "description": description,
        "source_url": "",
        "path": str(weight_path.resolve()),
        "display_path": _display_path(weight_path),
        "size_bytes": weight_path.stat().st_size,
        "kind": artifact_type,
        "checkpoint_id": checkpoint_id,
        "checkpoint_step": checkpoint_step,
    }


def _imported_lora_payloads() -> list[dict[str, object]]:
    if not IMPORTED_LORAS_ROOT.is_dir():
        return []

    loras: list[dict[str, object]] = []
    for lora_dir in sorted((item for item in IMPORTED_LORAS_ROOT.iterdir() if item.is_dir())):
        weight_path = _imported_weight_path(lora_dir)
        if weight_path is None:
            continue
        metadata = _read_request_payload(lora_dir / "metadata.json")
        trained_on_model = str(
            metadata.get("trained_on_model_id")
            or metadata.get("model")
            or ""
        ).strip()
        family = str(
            metadata.get("family")
            or metadata.get("model_family")
            or _family_from_model(trained_on_model)
        ).strip()
        compatible_models = _string_list(metadata.get("compatible_models")) or _compatible_models(trained_on_model)
        trigger_words = _string_list(metadata.get("trigger_words")) or _string_list(metadata.get("trigger_word"))
        slug = lora_dir.name
        loras.append(
            {
                "id": f"imported/{slug}",
                "name": str(metadata.get("name") or _name_from_slug(slug)).strip(),
                "family": family,
                "source_type": "imported",
                "artifact_type": "imported",
                "run_id": "",
                "dataset": "",
                "trained_on_model_id": trained_on_model,
                "model": trained_on_model,
                "compatible_models": compatible_models,
                "trigger_words": trigger_words,
                "trigger_word": trigger_words[0] if trigger_words else "",
                "default_strength": _float_or_none(metadata.get("default_strength")),
                "description": str(metadata.get("description") or "").strip(),
                "source_url": str(metadata.get("source_url") or "").strip(),
                "path": str(weight_path.resolve()),
                "display_path": _display_path(weight_path),
                "size_bytes": weight_path.stat().st_size,
                "kind": "imported",
                "checkpoint_id": "",
                "checkpoint_step": None,
            }
        )
    return loras


def _imported_weight_path(lora_dir: Path) -> Path | None:
    for name in IMPORTED_LORA_WEIGHT_NAMES:
        path = lora_dir / name
        if path.is_file():
            return path
    candidates = sorted(lora_dir.glob("*.safetensors"))
    return candidates[0] if candidates else None


def _image_pool_imported_lora_payloads() -> list[dict[str, object]]:
    try:
        payload = _request_image_pool_json(method="GET", path="/v1/admin/loras", timeout=3.0)
    except HTTPException:
        return []
    raw_loras = payload.get("data")
    if not isinstance(raw_loras, list):
        raw_loras = payload.get("loras")
    if not isinstance(raw_loras, list):
        return []
    return [item for item in raw_loras if isinstance(item, dict)]


def _uploaded_lora_path(upload_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_lora_upload", "message": "Invalid LoRA upload id."},
        )
    upload_dir = (LORA_IMPORT_UPLOADS_ROOT / upload_id).resolve()
    try:
        upload_dir.relative_to(LORA_IMPORT_UPLOADS_ROOT.resolve())
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_lora_upload", "message": "Invalid LoRA upload path."},
        ) from exc
    candidates = sorted(upload_dir.glob("*.safetensors"))
    if not candidates:
        raise HTTPException(
            status_code=404,
            detail={"error": "lora_upload_not_found", "message": "LoRA upload was not found."},
        )
    return candidates[0].resolve()


def _safe_upload_filename(filename: str) -> str:
    stem = re.sub(r"[^a-zA-Z0-9._ -]+", "-", Path(filename).name).strip(". ")
    return stem or "lora.safetensors"


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
    if model_id in {"flux2-klein-base-4b", "flux2-klein-4b"}:
        return ["flux2-klein-base-4b", "flux2-klein-4b"]
    if model_id in {"flux2-klein-base-9b", "flux2-klein-base-9b-fp8", "flux2-klein-9b", "flux2-klein-9b-fp8"}:
        return ["flux2-klein-base-9b", "flux2-klein-base-9b-fp8", "flux2-klein-9b", "flux2-klein-9b-fp8"]
    if model_id in {"z-image-base", "z-image-turbo"}:
        return ["z-image-base", "z-image-turbo"]
    return [model_id] if model_id else []


def _family_from_model(model: str) -> str:
    model_id = str(model or "").strip()
    if model_id.startswith("flux2-klein"):
        return "flux2-klein"
    if model_id.startswith("z-image"):
        return "z-image"
    if model_id.startswith("sdxl"):
        return "sdxl"
    return ""


def _string_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if "," in text:
            return [item.strip() for item in text.split(",") if item.strip()]
        return [text]
    return []


def _float_or_none(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _name_from_slug(slug: str) -> str:
    return " ".join(part for part in slug.replace("_", "-").split("-") if part).title() or "Imported LoRA"


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
