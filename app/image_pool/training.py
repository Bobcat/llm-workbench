from __future__ import annotations

import base64
import json
import mimetypes
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, request
from urllib.parse import quote

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.image_pool.models import _request_json as _request_image_pool_json
from app.prompt_testing.pool_client import _run_prompt_runner_payload

router = APIRouter(prefix="/image-pool/training", tags=["image-pool-training"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TRAINING_DATASETS_ROOT = PROJECT_ROOT / "data" / "image_pool" / "training" / "datasets"
TRAINING_RUNS_ROOT = PROJECT_ROOT / "data" / "image_pool" / "training" / "flux2-klein" / "runs"
Z_IMAGE_TRAINING_RUNS_ROOT = PROJECT_ROOT / "data" / "image_pool" / "training" / "z-image" / "runs"
DATASET_SLUG = "bfl-graphic-impressions"
TRIGGER_WORD = "GFX_IMPR5N"
SOURCE_URL = "https://docs.bfl.ml/flux_2/flux2_klein_training_example"
SOURCE_MARKDOWN_URL = "https://docs.bfl.ml/flux_2/flux2_klein_training_example.md"
MODEL_NAME_OR_PATH = "black-forest-labs/FLUX.2-klein-base-9B"
IMAGE_POOL_TRAINING_MODEL = "flux2-klein-base-4b"
FALLBACK_IMAGE_POOL_TRAINING_MODEL = "flux2-klein-4b"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
DATASET_FILE_EXTENSIONS = IMAGE_EXTENSIONS | {".txt"}
DEFAULT_CAPTION_SYSTEM_PROMPT = (
    "You write factual captions for image model training. "
    "A caption containing an invalid word fails the task."
)

TRAINING_IMAGE_URLS = (
    "https://cdn.sanity.io/images/2gpum2i6/production/1f64cb50e9b00262364e7a673afd2adb569d2d91-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/1fbadcc53bbcd32842d831784d748a670e90d74b-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/6a4a082ad54270231bf49a3c7214c9ae28ea9343-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/46c9da229a3a756e0f1dd85b411432858ff99258-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/f064f92f9c6904fa60bb827bde5f50da7120b3ee-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/5248fa9f913969ad7e07716373ae08132d23678a-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/548352f8acf5f67b3e0258541aeeda6b5ea8ab03-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/e5cef902965bbb1ccacb39e1f34c0464162a25ed-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/30db164600d191cdd906753ced19b1cc9d9df1c0-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/86886f62f6cc4536aab0b846b2a157f029e0cc2b-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/230eac6b178fca0801fd8f6dafda6a9a06aca4f7-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/aef54299d95e1afe391ba48473daa306e29e6afb-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/d748a200bf42a04924737c212168fba5d39d2412-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/b7e29f13db0de89f893f955993b212f5dfb415a7-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/d4c30c87baaed75eb8d867d3ad8abef24636fd7c-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/e61498a50614678d1ac3c235be50d375983a652e-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/622e2e96197cc6f1d6ddbda09ad6623f0f0f3832-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/9ab4da45e77e5feeb45c8cea647dd2b7df88f9ee-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/27532886f3f3fe38e6ff8428a4a8c64eb3d15a03-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/cbcb4651e2144cdbf6070c2d7bc216a7d611e5ad-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/fabccde500aa1a5ed6774963d9f41b951e8d8102-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/1b357d36054b9ec27e970a162391a1c4ca2b03a9-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/5569f32aa3a4cafe32ca8ed27e312e829a2567e0-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/f46e945fbc6a0fe8da088c9d073c3aae1ec472cc-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/80815c377e407d3ff241231d579582c108c94f36-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/869305dbfda66ea80886c39fce93e4a559b15a7d-2752x1536.png",
    "https://cdn.sanity.io/images/2gpum2i6/production/854df51da05db3759e024782bb11fa62381ab353-2752x1536.png",
)


class DatasetCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    trigger_word: str = Field(default=TRIGGER_WORD, min_length=1)


class CaptionRequest(BaseModel):
    model: str
    image_id: str
    trigger_word: str = TRIGGER_WORD
    caption_prompt: str | None = None
    system_prompt: str = DEFAULT_CAPTION_SYSTEM_PROMPT
    overwrite: bool = True


class TrainingStartRequest(BaseModel):
    trainer: str = "flux"
    model: str = IMAGE_POOL_TRAINING_MODEL
    trigger_word: str = TRIGGER_WORD
    steps: int | None = Field(default=None, ge=1)
    learning_rate: float | None = Field(default=None, gt=0)
    rank: int | None = Field(default=None, ge=1)
    alpha: int | None = Field(default=None, ge=1)
    batch_size: int | None = Field(default=None, ge=1)
    checkpoint_interval: int | None = Field(default=None, ge=1)
    resolution: int | None = Field(default=None, ge=256, le=1536)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sample_entries() -> list[dict[str, str]]:
    return [
        {
            "id": f"{index:02d}",
            "label": f"Training {index}",
            "filename": f"GFX_IMP ({index}).png",
            "caption_filename": f"GFX_IMP ({index}).txt",
            "image_url": url,
            "source": "sample",
        }
        for index, url in enumerate(TRAINING_IMAGE_URLS, start=1)
    ]


def _slugify(value: str, fallback: str = "dataset") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return slug[:80] or fallback


def _unique_dataset_slug(name: str) -> str:
    base_slug = _slugify(name)
    slug = base_slug
    index = 2
    while _dataset_root(slug).exists():
        slug = f"{base_slug}-{index}"
        index += 1
    return slug


def _dataset_root(slug: str) -> Path:
    return TRAINING_DATASETS_ROOT / _slugify(slug)


def _metadata_path(slug: str) -> Path:
    return _dataset_root(slug) / "dataset.json"


def _manifest_path(slug: str) -> Path:
    return _dataset_root(slug) / "manifest.json"


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def _default_metadata(slug: str) -> dict[str, object]:
    if slug == DATASET_SLUG:
        return {
            "slug": DATASET_SLUG,
            "title": "BFL Graphic Impressions",
            "source": "sample",
            "trigger_word": TRIGGER_WORD,
            "created_at": "",
            "updated_at": "",
        }
    return {
        "slug": slug,
        "title": slug,
        "source": "custom",
        "trigger_word": TRIGGER_WORD,
        "created_at": "",
        "updated_at": "",
    }


def _read_dataset_metadata(slug: str) -> dict[str, object]:
    metadata = _default_metadata(slug)
    path = _metadata_path(slug)
    if not path.is_file():
        return metadata
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return metadata
    if not isinstance(payload, dict):
        return metadata
    metadata.update(payload)
    metadata["slug"] = slug
    return metadata


def _write_dataset_metadata(slug: str, metadata: dict[str, object]) -> None:
    root = _dataset_root(slug)
    root.mkdir(parents=True, exist_ok=True)
    payload = {**_default_metadata(slug), **metadata, "slug": slug, "updated_at": _utc_now()}
    if not payload.get("created_at"):
        payload["created_at"] = payload["updated_at"]
    _metadata_path(slug).write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _ensure_dataset(slug: str, *, title: str | None = None, source: str | None = None) -> dict[str, object]:
    normalized = _slugify(slug)
    metadata = _read_dataset_metadata(normalized)
    if title is not None:
        metadata["title"] = title
    if source is not None:
        metadata["source"] = source
    if not _metadata_path(normalized).is_file():
        _write_dataset_metadata(normalized, metadata)
    return _read_dataset_metadata(normalized)


def _sample_dataset_is_complete() -> bool:
    root = _dataset_root(DATASET_SLUG)
    if not root.is_dir():
        return False
    return all(_image_path(DATASET_SLUG, entry).is_file() for entry in _sample_entries())


def _known_dataset_slugs() -> list[str]:
    slugs = set()
    if TRAINING_DATASETS_ROOT.exists():
        slugs.update(
            item.name
            for item in TRAINING_DATASETS_ROOT.iterdir()
            if item.is_dir() and (item.name != DATASET_SLUG or _sample_dataset_is_complete())
        )
    return sorted(slugs, key=lambda slug: (0 if slug == DATASET_SLUG else 1, slug))


def _require_dataset(slug: str) -> str:
    normalized = _slugify(slug)
    if not _dataset_root(normalized).is_dir():
        raise HTTPException(status_code=404, detail="Dataset not found.")
    if normalized == DATASET_SLUG and not _sample_dataset_is_complete():
        raise HTTPException(status_code=404, detail="Dataset not found.")
    return normalized


def _dataset_entries(slug: str) -> list[dict[str, str]]:
    metadata = _read_dataset_metadata(slug)
    if metadata.get("source") == "sample" or slug == DATASET_SLUG:
        return _sample_entries()

    root = _dataset_root(slug)
    image_paths = sorted(item for item in root.iterdir() if item.is_file() and item.suffix.lower() in IMAGE_EXTENSIONS)
    return [
        {
            "id": f"{index:02d}",
            "label": image_path.stem,
            "filename": image_path.name,
            "caption_filename": f"{image_path.stem}.txt",
            "image_url": "",
            "source": "local",
        }
        for index, image_path in enumerate(image_paths, start=1)
    ]


def _image_path(slug: str, entry: dict[str, str]) -> Path:
    return _dataset_root(slug) / entry["filename"]


def _caption_path(slug: str, entry: dict[str, str]) -> Path:
    return _dataset_root(slug) / entry["caption_filename"]


def _read_caption(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8").strip()


def _dataset_image_url(slug: str, entry: dict[str, str], image_path: Path) -> str:
    if image_path.exists():
        return f"/api/image-pool/training/datasets/{quote(slug)}/images/{quote(image_path.name)}"
    return ""


def _image_status(slug: str, entry: dict[str, str]) -> dict[str, object]:
    image_path = _image_path(slug, entry)
    caption_path = _caption_path(slug, entry)
    caption = _read_caption(caption_path)
    return {
        **entry,
        "downloaded": image_path.exists(),
        "captioned": bool(caption),
        "image_path": _display_path(image_path),
        "caption_path": _display_path(caption_path),
        "image_url": _dataset_image_url(slug, entry, image_path),
        "caption": caption,
    }


def _dataset_payload(slug: str) -> dict[str, object]:
    normalized = _require_dataset(slug)
    metadata = _ensure_dataset(normalized) if normalized == DATASET_SLUG else _read_dataset_metadata(normalized)
    images = [_image_status(normalized, entry) for entry in _dataset_entries(normalized)]
    downloaded = sum(1 for image in images if image["downloaded"])
    captioned = sum(1 for image in images if image["captioned"])
    training_models = _image_pool_training_models()
    return {
        "slug": normalized,
        "title": str(metadata.get("title") or normalized),
        "source": str(metadata.get("source") or "custom"),
        "source_url": SOURCE_URL if normalized == DATASET_SLUG else "",
        "source_markdown_url": SOURCE_MARKDOWN_URL if normalized == DATASET_SLUG else "",
        "trigger_word": str(metadata.get("trigger_word") or TRIGGER_WORD),
        "model_name_or_path": MODEL_NAME_OR_PATH,
        "training_model": _default_training_model(training_models),
        "training_models": training_models,
        "caption_prompt": _caption_prompt(str(metadata.get("trigger_word") or TRIGGER_WORD)),
        "caption_system_prompt": DEFAULT_CAPTION_SYSTEM_PROMPT,
        "caption_decoding": _caption_decoding(),
        "dataset_path": _display_path(_dataset_root(normalized)),
        "dataset_absolute_path": str(_dataset_root(normalized).resolve()),
        "images_path": _display_path(_dataset_root(normalized)),
        "captions_path": _display_path(_dataset_root(normalized)),
        "runs_path": _display_path(_runs_root()),
        "image_count": len(images),
        "downloaded_count": downloaded,
        "captioned_count": captioned,
        "images": images,
    }


def _dataset_summary(slug: str) -> dict[str, object]:
    payload = _dataset_payload(slug)
    return {
        "slug": payload["slug"],
        "title": payload["title"],
        "source": payload["source"],
        "dataset_path": payload["dataset_path"],
        "image_count": payload["image_count"],
        "downloaded_count": payload["downloaded_count"],
        "captioned_count": payload["captioned_count"],
    }


def _datasets_payload() -> dict[str, object]:
    datasets = [_dataset_summary(slug) for slug in _known_dataset_slugs()]
    return {
        "default_slug": str(datasets[0]["slug"]) if datasets else "",
        "datasets": datasets,
    }


def _dataset_readiness(slug: str) -> dict[str, object]:
    images = [_image_status(slug, entry) for entry in _dataset_entries(slug)]
    missing_images = [str(image["id"]) for image in images if not image["downloaded"]]
    missing_captions = [str(image["id"]) for image in images if not image["captioned"]]
    return {
        "ready": bool(images) and not missing_images and not missing_captions,
        "image_count": len(images),
        "downloaded_count": len(images) - len(missing_images),
        "captioned_count": len(images) - len(missing_captions),
        "missing_images": missing_images,
        "missing_captions": missing_captions,
    }


def _require_dataset_ready(slug: str) -> None:
    readiness = _dataset_readiness(slug)
    if readiness["ready"]:
        return
    raise HTTPException(
        status_code=409,
        detail={
            "error": "training_dataset_not_ready",
            "message": "Import or download images and caption every training image before starting training.",
            **readiness,
        },
    )


def _normalize_trainer(value: str) -> str:
    return "z-image" if str(value or "").strip().lower() in {"z-image", "z_image", "diffusers_z_image_lora"} else "flux"


def _trainer_for_backend(backend: str) -> str:
    return "z-image" if backend == "diffusers_z_image" else "flux"


def _trainer_endpoint(trainer: str) -> str:
    return "z-image-lora" if _normalize_trainer(trainer) == "z-image" else "flux-lora"


def _trainer_backend_id(trainer: str) -> str:
    return "diffusers_z_image_lora" if _normalize_trainer(trainer) == "z-image" else "diffusers_flux2_lora"


def _runs_root(trainer: str = "flux") -> Path:
    return Z_IMAGE_TRAINING_RUNS_ROOT if _normalize_trainer(trainer) == "z-image" else TRAINING_RUNS_ROOT


def _image_pool_training_unavailable_payload(message: str, trainer: str = "flux") -> dict[str, object]:
    return {
        "backend": {
            "id": _trainer_backend_id(trainer),
            "implemented": False,
            "available": False,
            "missing_dependencies": [],
            "message": message,
        },
        "run": {
            "status": "unavailable",
            "run_id": "",
            "pid": None,
            "returncode": None,
            "started_at": "",
            "completed_at": "",
            "output_path": "",
            "log_tail": "",
            "message": message,
        },
    }


def _image_pool_training_status(trainer: str = "flux") -> dict[str, object]:
    try:
        payload = _request_image_pool_json(
            method="GET",
            path=f"/v1/training/{_trainer_endpoint(trainer)}",
            timeout=3.0,
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        message = str(detail.get("message") or detail.get("error") or exc.detail)
        return _image_pool_training_unavailable_payload(message, trainer)
    return payload if isinstance(payload, dict) else _image_pool_training_unavailable_payload("Invalid image-pool training status.", trainer)


def _image_pool_training_models() -> list[dict[str, object]]:
    try:
        payload = _request_image_pool_json(
            method="GET",
            path="/v1/admin/models",
            timeout=3.0,
        )
    except (HTTPException, ValueError):
        return []

    raw_models = payload.get("data")
    if not isinstance(raw_models, list):
        raw_models = payload.get("models")
    if not isinstance(raw_models, list):
        return []

    training_models: list[dict[str, object]] = []
    for raw_model in raw_models:
        if not isinstance(raw_model, dict):
            continue
        model_id = str(raw_model.get("id") or raw_model.get("name") or "").strip()
        backend = str(raw_model.get("backend") or raw_model.get("resolved_backend") or "").strip()
        if not model_id or backend not in {"diffusers_flux2_klein", "diffusers_z_image"}:
            continue
        model_path = str(raw_model.get("model_path") or "").strip()
        model_path_exists = Path(model_path).expanduser().exists() if model_path else False
        training_models.append(
            {
                "id": model_id,
                "name": model_id,
                "backend": backend,
                "trainer": _trainer_for_backend(backend),
                "model_path": model_path,
                "ready": model_path_exists,
                "loaded": bool(raw_model.get("loaded") or raw_model.get("is_loaded")),
                "base": "-base" in model_id.lower(),
                "vram_estimate_mib": raw_model.get("vram_estimate_mib"),
            }
        )
    return sorted(training_models, key=_training_model_sort_key)


def _training_model_sort_key(model: dict[str, object]) -> tuple[int, str]:
    model_id = str(model.get("id") or "")
    if model_id == IMAGE_POOL_TRAINING_MODEL:
        priority = 0
    elif "-base" in model_id.lower():
        priority = 1 if model.get("trainer") == "flux" else 2
    elif model_id == FALLBACK_IMAGE_POOL_TRAINING_MODEL:
        priority = 3
    else:
        priority = 4
    return (priority, model_id)


def _default_training_model(training_models: list[dict[str, object]] | None = None, trainer: str | None = None) -> str:
    models = training_models if training_models is not None else _image_pool_training_models()
    normalized_trainer = _normalize_trainer(trainer) if trainer is not None else ""
    if normalized_trainer:
        trainer_models = [model for model in models if _normalize_trainer(str(model.get("trainer") or "flux")) == normalized_trainer]
        if trainer_models:
            models = trainer_models
    model_ids = [str(model.get("id") or "") for model in models]
    if IMAGE_POOL_TRAINING_MODEL in model_ids:
        return IMAGE_POOL_TRAINING_MODEL
    if FALLBACK_IMAGE_POOL_TRAINING_MODEL in model_ids:
        return FALLBACK_IMAGE_POOL_TRAINING_MODEL
    return model_ids[0] if model_ids else IMAGE_POOL_TRAINING_MODEL


def _training_model_trainer(model_id: str, training_models: list[dict[str, object]] | None = None) -> str:
    models = training_models if training_models is not None else _image_pool_training_models()
    for model in models:
        if str(model.get("id") or "") == model_id:
            return _normalize_trainer(str(model.get("trainer") or "flux"))
    return "flux"


def _training_defaults(trainer: str) -> dict[str, object]:
    if _normalize_trainer(trainer) == "z-image":
        return {
            "steps": 500,
            "learning_rate": 0.0001,
            "rank": 4,
            "alpha": 4,
            "batch_size": 1,
            "checkpoint_interval": 500,
            "resolution": 1024,
        }
    return {
        "steps": 3000,
        "learning_rate": 0.000095,
        "rank": 128,
        "alpha": 64,
        "batch_size": 1,
        "checkpoint_interval": 500,
        "resolution": [256, 512, 768, 1024, 1280, 1536],
    }


def _training_request_payload(slug: str, start_request: TrainingStartRequest) -> dict[str, object]:
    dataset = _dataset_payload(slug)
    model = start_request.model.strip() or _default_training_model()
    trainer = _training_model_trainer(model)
    defaults = _training_defaults(trainer)
    resolution: object = start_request.resolution or defaults["resolution"]
    if trainer == "flux":
        resolution = defaults["resolution"]
    return {
        "model": model,
        "dataset_path": str(_dataset_root(slug).resolve()),
        "output_path": str(_runs_root(trainer).resolve()),
        "trigger_word": start_request.trigger_word.strip() or TRIGGER_WORD,
        "steps": start_request.steps or defaults["steps"],
        "learning_rate": start_request.learning_rate or defaults["learning_rate"],
        "rank": start_request.rank or defaults["rank"],
        "alpha": start_request.alpha or defaults["alpha"],
        "batch_size": start_request.batch_size or defaults["batch_size"],
        "checkpoint_interval": start_request.checkpoint_interval or defaults["checkpoint_interval"],
        "resolution": resolution,
        "metadata": {"dataset": slug, "dataset_title": dataset["title"], "trainer": trainer},
    }


def _training_status_payload(slug: str, trainer: str = "flux") -> dict[str, object]:
    normalized = _require_dataset(slug)
    normalized_trainer = _normalize_trainer(trainer)
    image_pool_payload = _image_pool_training_status(normalized_trainer)
    backend = image_pool_payload.get("backend", {})
    run = image_pool_payload.get("run", {})
    training_models = _image_pool_training_models()
    return {
        "trainer": backend if isinstance(backend, dict) else {},
        "dataset": _dataset_readiness(normalized),
        "run": run if isinstance(run, dict) else {},
        "request": _training_request_payload(
            normalized,
            TrainingStartRequest(
                trainer=normalized_trainer,
                model=_default_training_model(training_models, normalized_trainer),
            ),
        ),
        "training_models": training_models,
    }


def _unwrap_image_pool_http_exception(exc: HTTPException) -> HTTPException:
    detail = exc.detail
    if isinstance(detail, dict) and isinstance(detail.get("detail"), dict):
        detail = detail["detail"]
    return HTTPException(status_code=exc.status_code, detail=detail)


def _download_image(slug: str, entry: dict[str, str]) -> bool:
    image_path = _image_path(slug, entry)
    if image_path.exists():
        return False
    image_url = entry.get("image_url", "")
    if not image_url:
        raise HTTPException(status_code=404, detail="Dataset image file is missing.")

    image_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with request.urlopen(image_url, timeout=60.0) as response:
            content = response.read()
    except error.URLError as exc:
        raise HTTPException(
            status_code=502,
            detail={"error": "training_image_download_failed", "message": str(exc)},
        ) from exc

    if not content:
        raise HTTPException(
            status_code=502,
            detail={"error": "training_image_download_failed", "message": "Empty response body."},
        )

    _write_dataset_file(image_path, content)
    return True


def _image_data_url(path: Path) -> str:
    mime_type = mimetypes.guess_type(path.name)[0] or "image/png"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _caption_prompt(trigger_word: str) -> str:
    return "\n".join(
        [
            "Caption the image for a style LoRA dataset. Describe what is depicted, not how it is rendered.",
            f"Begin exactly: {trigger_word}.",
            "Use 2 or 3 complete sentences, 50 to 85 words total.",
            "Describe camera distance, viewing angle, subject orientation, pose or action, important body parts or objects, frame placement, and real physical ground or setting.",
            "Omit style and rendering details, including colors, lighting, shadows, texture, brushwork, linework, graphic marks, speckles, particles, fragments, streaks, rays, decorative effects, mood, and background color.",
            "Never describe floating, suspended, scattered, abstract, or decorative background elements. If the background has no real place or objects, write against an open background.",
            "The words dark, black, red, white, blue, purple, textured, texture, fragments, particles, streaks, rays, glow, and shadow make the caption invalid.",
            "Use neutral object nouns instead: ground surface, shirt, pants, bridge, flowers, tunnel, open background.",
            "Before returning, check the caption and rewrite it if any invalid word appears.",
            "Return only the caption.",
        ]
    )


def _caption_decoding() -> dict[str, object]:
    return {
        "max_tokens": 700,
        "temperature": 0,
        "top_p": 0.95,
    }


def _caption_payload(
    model: str,
    *,
    caption_prompt: str,
    system_prompt: str,
    image_data_url: str,
) -> dict[str, object]:
    return {
        "model": model,
        "input": [
            {"type": "text", "text": caption_prompt},
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ],
        "instructions": system_prompt,
        "allow_remote": False,
        "stream": False,
        "thinking": "default",
        "decoding": _caption_decoding(),
    }


def _normalize_caption(text: str, trigger_word: str) -> str:
    caption = " ".join(str(text or "").strip().split())
    expected_prefix = f"{trigger_word}."
    if not caption:
        raise HTTPException(status_code=502, detail="Caption response was empty.")
    if not caption.startswith(expected_prefix):
        caption = f"{expected_prefix} {caption}"
    return caption


def _find_entry(slug: str, image_id: str) -> dict[str, str]:
    normalized_id = str(image_id or "").strip()
    if normalized_id.isdigit():
        normalized_id = f"{int(normalized_id):02d}"
    for entry in _dataset_entries(slug):
        if entry["id"] == normalized_id:
            return entry
    raise HTTPException(status_code=404, detail="Training image not found.")


def _safe_dataset_filename(filename: str) -> str:
    name = Path(str(filename or "")).name.strip()
    if not name or name in {".", ".."} or name.startswith("."):
        raise HTTPException(status_code=400, detail="Invalid dataset filename.")
    suffix = Path(name).suffix.lower()
    if suffix not in DATASET_FILE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported dataset file type.")
    return name


def _write_dataset_file(path: Path, content: bytes) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() == content:
        return False
    temp_path = path.with_suffix(f"{path.suffix}.tmp")
    temp_path.write_bytes(content)
    temp_path.replace(path)
    return True


def _write_manifest(slug: str) -> None:
    root = _dataset_root(slug)
    files = []
    if root.exists():
        for path in sorted(item for item in root.iterdir() if item.is_file() and item.name not in {"dataset.json", "manifest.json"}):
            files.append(
                {
                    "name": path.name,
                    "size_bytes": path.stat().st_size,
                    "modified_at": datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                }
            )
    _manifest_path(slug).write_text(
        json.dumps({"slug": slug, "updated_at": _utc_now(), "files": files}, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _dataset_file_path(slug: str, filename: str) -> Path:
    root = _dataset_root(slug).resolve()
    path = (root / _safe_dataset_filename(filename)).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Dataset file not found.") from exc
    return path


@router.get("/datasets")
def list_training_datasets() -> dict[str, object]:
    return _datasets_payload()


@router.post("/datasets")
def create_training_dataset(create_request: DatasetCreateRequest) -> dict[str, object]:
    title = " ".join(create_request.name.strip().split())
    slug = _unique_dataset_slug(title)
    _write_dataset_metadata(
        slug,
        {
            "title": title,
            "source": "custom",
            "trigger_word": create_request.trigger_word.strip() or TRIGGER_WORD,
        },
    )
    _write_manifest(slug)
    return {"dataset": _dataset_payload(slug), "datasets": _datasets_payload()["datasets"]}


@router.delete("/datasets/{slug}")
def delete_training_dataset(slug: str) -> dict[str, object]:
    normalized = _slugify(slug)
    if normalized != DATASET_SLUG:
        normalized = _require_dataset(normalized)
    root = _dataset_root(normalized).resolve()
    datasets_root = TRAINING_DATASETS_ROOT.resolve()
    try:
        root.relative_to(datasets_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid dataset path.") from exc

    if not root.exists():
        raise HTTPException(status_code=404, detail="Dataset not found.")
    try:
        shutil.rmtree(root)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete dataset: {exc}") from exc

    payload = _datasets_payload()
    payload["deleted_slug"] = normalized
    return payload


@router.get("/datasets/{slug}")
def get_training_dataset(slug: str) -> dict[str, object]:
    return _dataset_payload(slug)


@router.get("/datasets/{slug}/images/{filename:path}")
def get_training_dataset_image(slug: str, filename: str) -> FileResponse:
    normalized = _require_dataset(slug)
    path = _dataset_file_path(normalized, filename)
    if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=404, detail="Dataset image not found.")
    return FileResponse(path, media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream")


@router.post("/datasets/{slug}/files")
async def upload_training_dataset_files(slug: str, files: list[UploadFile] = File(...)) -> dict[str, object]:
    normalized = _require_dataset(slug)
    imported = 0
    updated = 0
    skipped = 0
    ignored = 0
    for upload in files:
        try:
            filename = _safe_dataset_filename(upload.filename or "")
        except HTTPException:
            ignored += 1
            continue
        content = await upload.read()
        if not content:
            ignored += 1
            continue
        path = _dataset_root(normalized) / filename
        existed = path.exists()
        changed = _write_dataset_file(path, content)
        if changed and existed:
            updated += 1
        elif changed:
            imported += 1
        else:
            skipped += 1
    _write_manifest(normalized)
    payload = _dataset_payload(normalized)
    payload.update({"imported": imported, "updated": updated, "skipped": skipped, "ignored": ignored})
    return payload


@router.post("/datasets/{slug}/sample-download")
def download_sample_training_dataset(slug: str) -> dict[str, object]:
    normalized = _slugify(slug)
    if normalized != DATASET_SLUG:
        raise HTTPException(status_code=400, detail="Sample download is only available for the BFL sample dataset.")
    _ensure_dataset(DATASET_SLUG, title="BFL Graphic Impressions", source="sample")
    downloaded_now = 0
    existing = 0
    for entry in _sample_entries():
        if _download_image(DATASET_SLUG, entry):
            downloaded_now += 1
        else:
            existing += 1
    _write_manifest(DATASET_SLUG)
    payload = _dataset_payload(DATASET_SLUG)
    payload["downloaded_now"] = downloaded_now
    payload["existing"] = existing
    return payload


@router.get("/datasets/{slug}/run")
def get_training_run(slug: str, trainer: str = "flux") -> dict[str, object]:
    return _training_status_payload(_require_dataset(slug), trainer)


@router.post("/datasets/{slug}/run")
def start_training_run(slug: str, start_request: TrainingStartRequest) -> dict[str, object]:
    normalized = _require_dataset(slug)
    _require_dataset_ready(normalized)
    selected_model = start_request.model.strip() or _default_training_model()
    trainer = _training_model_trainer(selected_model)
    try:
        _request_image_pool_json(
            method="POST",
            path=f"/v1/training/{_trainer_endpoint(trainer)}",
            payload=_training_request_payload(normalized, start_request),
            timeout=30.0,
        )
    except HTTPException as exc:
        raise _unwrap_image_pool_http_exception(exc) from exc
    return _training_status_payload(normalized, trainer)


@router.post("/datasets/{slug}/stop")
def stop_training_run(slug: str, trainer: str = "flux") -> dict[str, object]:
    normalized = _require_dataset(slug)
    normalized_trainer = _normalize_trainer(trainer)
    try:
        _request_image_pool_json(
            method="POST",
            path=f"/v1/training/{_trainer_endpoint(normalized_trainer)}/stop",
            timeout=10.0,
        )
    except HTTPException as exc:
        raise _unwrap_image_pool_http_exception(exc) from exc
    return _training_status_payload(normalized, normalized_trainer)


@router.post("/datasets/{slug}/caption")
def caption_training_image(slug: str, caption_request: CaptionRequest) -> dict[str, object]:
    normalized = _require_dataset(slug)
    model = caption_request.model.strip()
    if model == "":
        raise HTTPException(status_code=400, detail="Model must not be empty.")

    trigger_word = caption_request.trigger_word.strip() or TRIGGER_WORD
    caption_prompt = (caption_request.caption_prompt or _caption_prompt(trigger_word)).strip()
    system_prompt = caption_request.system_prompt.strip() or DEFAULT_CAPTION_SYSTEM_PROMPT
    if caption_prompt == "":
        raise HTTPException(status_code=400, detail="Caption prompt must not be empty.")
    entry = _find_entry(normalized, caption_request.image_id)
    _download_image(normalized, entry)

    caption_path = _caption_path(normalized, entry)
    if caption_path.exists() and not caption_request.overwrite:
        return {"image": _image_status(normalized, entry), "caption": _read_caption(caption_path)}

    try:
        response_json, transport_completed_ms = _run_prompt_runner_payload(
            _caption_payload(
                model,
                caption_prompt=caption_prompt,
                system_prompt=system_prompt,
                image_data_url=_image_data_url(_image_path(normalized, entry)),
            )
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    caption = _normalize_caption(str(response_json.get("output_text") or ""), trigger_word)
    caption_path.parent.mkdir(parents=True, exist_ok=True)
    caption_path.write_text(f"{caption}\n", encoding="utf-8")
    _write_manifest(normalized)
    metrics = response_json.get("metrics", {})
    if not isinstance(metrics, dict):
        metrics = {}
    return {
        "image": _image_status(normalized, entry),
        "caption": caption,
        "model": str(response_json.get("model") or model),
        "request_id": str(response_json.get("id") or ""),
        "metrics": {
            "transport_completed_ms": transport_completed_ms,
            "engine_prompt_tokens": metrics.get("engine_prompt_tokens"),
            "engine_output_tokens": metrics.get("engine_output_tokens"),
            "engine_tokens_per_second": metrics.get("engine_tokens_per_second"),
        },
    }
