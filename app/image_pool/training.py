from __future__ import annotations

import base64
import mimetypes
from pathlib import Path
from urllib import error, request

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.image_pool.models import _request_json as _request_image_pool_json
from app.prompt_testing.pool_client import _run_prompt_runner_payload

router = APIRouter(prefix="/image-pool/training", tags=["image-pool-training"])

PROJECT_ROOT = Path(__file__).resolve().parents[2]
TRAINING_DATA_ROOT = (
    PROJECT_ROOT / "data" / "image_pool" / "training" / "flux2-klein" / "graphic-impressions"
)
TRAINING_RUNS_ROOT = PROJECT_ROOT / "data" / "image_pool" / "training" / "flux2-klein" / "runs"
DATASET_SLUG = "bfl-graphic-impressions"
TRIGGER_WORD = "GFX_IMPR5N"
SOURCE_URL = "https://docs.bfl.ml/flux_2/flux2_klein_training_example"
SOURCE_MARKDOWN_URL = "https://docs.bfl.ml/flux_2/flux2_klein_training_example.md"
MODEL_NAME_OR_PATH = "black-forest-labs/FLUX.2-klein-base-9B"
IMAGE_POOL_TRAINING_MODEL = "flux2-klein-base-4b"
FALLBACK_IMAGE_POOL_TRAINING_MODEL = "flux2-klein-4b"
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


class CaptionRequest(BaseModel):
    model: str
    image_id: str
    trigger_word: str = TRIGGER_WORD
    caption_prompt: str | None = None
    system_prompt: str = DEFAULT_CAPTION_SYSTEM_PROMPT
    overwrite: bool = True


class TrainingStartRequest(BaseModel):
    model: str = IMAGE_POOL_TRAINING_MODEL
    trigger_word: str = TRIGGER_WORD
    steps: int = Field(default=3000, ge=1)
    learning_rate: float = Field(default=0.000095, gt=0)
    rank: int = Field(default=128, ge=1)
    alpha: int = Field(default=64, ge=1)
    batch_size: int = Field(default=1, ge=1)


def _entries() -> list[dict[str, str]]:
    return [
        {
            "id": f"{index:02d}",
            "label": f"Training {index}",
            "filename": f"GFX_IMP ({index}).png",
            "caption_filename": f"GFX_IMP ({index}).txt",
            "image_url": url,
        }
        for index, url in enumerate(TRAINING_IMAGE_URLS, start=1)
    ]


def _dataset_root() -> Path:
    return TRAINING_DATA_ROOT


def _images_dir() -> Path:
    return _dataset_root()


def _captions_dir() -> Path:
    return _dataset_root()


def _image_path(entry: dict[str, str]) -> Path:
    return _images_dir() / entry["filename"]


def _caption_path(entry: dict[str, str]) -> Path:
    return _captions_dir() / entry["caption_filename"]


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        return str(path)


def _find_entry(image_id: str) -> dict[str, str]:
    normalized = str(image_id or "").strip()
    if normalized.isdigit():
        normalized = f"{int(normalized):02d}"
    for entry in _entries():
        if entry["id"] == normalized:
            return entry
    raise HTTPException(status_code=404, detail="Training image not found.")


def _read_caption(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8").strip()


def _image_status(entry: dict[str, str]) -> dict[str, object]:
    image_path = _image_path(entry)
    caption_path = _caption_path(entry)
    caption = _read_caption(caption_path)
    return {
        **entry,
        "downloaded": image_path.exists(),
        "captioned": bool(caption),
        "image_path": _display_path(image_path),
        "caption_path": _display_path(caption_path),
        "caption": caption,
    }


def _dataset_payload() -> dict[str, object]:
    images = [_image_status(entry) for entry in _entries()]
    downloaded = sum(1 for image in images if image["downloaded"])
    captioned = sum(1 for image in images if image["captioned"])
    training_models = _image_pool_training_models()
    return {
        "slug": DATASET_SLUG,
        "title": "BFL Graphic Impressions",
        "source_url": SOURCE_URL,
        "source_markdown_url": SOURCE_MARKDOWN_URL,
        "trigger_word": TRIGGER_WORD,
        "model_name_or_path": MODEL_NAME_OR_PATH,
        "training_model": _default_training_model(training_models),
        "training_models": training_models,
        "caption_prompt": _caption_prompt(TRIGGER_WORD),
        "caption_system_prompt": DEFAULT_CAPTION_SYSTEM_PROMPT,
        "caption_decoding": _caption_decoding(),
        "dataset_path": _display_path(_dataset_root()),
        "dataset_absolute_path": str(_dataset_root().resolve()),
        "images_path": _display_path(_images_dir()),
        "captions_path": _display_path(_captions_dir()),
        "runs_path": _display_path(_runs_root()),
        "image_count": len(images),
        "downloaded_count": downloaded,
        "captioned_count": captioned,
        "images": images,
    }


def _runs_root() -> Path:
    return TRAINING_RUNS_ROOT


def _dataset_readiness() -> dict[str, object]:
    images = [_image_status(entry) for entry in _entries()]
    missing_images = [str(image["id"]) for image in images if not image["downloaded"]]
    missing_captions = [str(image["id"]) for image in images if not image["captioned"]]
    return {
        "ready": not missing_images and not missing_captions,
        "image_count": len(images),
        "downloaded_count": len(images) - len(missing_images),
        "captioned_count": len(images) - len(missing_captions),
        "missing_images": missing_images,
        "missing_captions": missing_captions,
    }


def _require_dataset_ready() -> None:
    readiness = _dataset_readiness()
    if readiness["ready"]:
        return
    raise HTTPException(
        status_code=409,
        detail={
            "error": "training_dataset_not_ready",
            "message": "Download and caption every training image before starting training.",
            **readiness,
        },
    )


def _image_pool_training_unavailable_payload(message: str) -> dict[str, object]:
    return {
        "backend": {
            "id": "diffusers_flux2_lora",
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


def _image_pool_training_status() -> dict[str, object]:
    try:
        payload = _request_image_pool_json(
            method="GET",
            path="/v1/training/flux-lora",
            timeout=3.0,
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {}
        message = str(detail.get("message") or detail.get("error") or exc.detail)
        return _image_pool_training_unavailable_payload(message)
    return payload if isinstance(payload, dict) else _image_pool_training_unavailable_payload("Invalid image-pool training status.")


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
        if not model_id or backend != "diffusers_flux2_klein":
            continue
        model_path = str(raw_model.get("model_path") or "").strip()
        model_path_exists = Path(model_path).expanduser().exists() if model_path else False
        training_models.append(
            {
                "id": model_id,
                "name": model_id,
                "backend": backend,
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
        priority = 1
    elif model_id == FALLBACK_IMAGE_POOL_TRAINING_MODEL:
        priority = 2
    else:
        priority = 3
    return (priority, model_id)


def _default_training_model(training_models: list[dict[str, object]] | None = None) -> str:
    models = training_models if training_models is not None else _image_pool_training_models()
    model_ids = [str(model.get("id") or "") for model in models]
    if IMAGE_POOL_TRAINING_MODEL in model_ids:
        return IMAGE_POOL_TRAINING_MODEL
    if FALLBACK_IMAGE_POOL_TRAINING_MODEL in model_ids:
        return FALLBACK_IMAGE_POOL_TRAINING_MODEL
    return model_ids[0] if model_ids else IMAGE_POOL_TRAINING_MODEL


def _training_request_payload(start_request: TrainingStartRequest) -> dict[str, object]:
    return {
        "model": start_request.model.strip() or _default_training_model(),
        "dataset_path": str(_dataset_root().resolve()),
        "output_path": str(_runs_root().resolve()),
        "trigger_word": start_request.trigger_word.strip() or TRIGGER_WORD,
        "steps": start_request.steps,
        "learning_rate": start_request.learning_rate,
        "rank": start_request.rank,
        "alpha": start_request.alpha,
        "batch_size": start_request.batch_size,
        "resolution": [256, 512, 768, 1024, 1280, 1536],
        "metadata": {"dataset": DATASET_SLUG},
    }


def _training_status_payload() -> dict[str, object]:
    image_pool_payload = _image_pool_training_status()
    backend = image_pool_payload.get("backend", {})
    run = image_pool_payload.get("run", {})
    training_models = _image_pool_training_models()
    return {
        "trainer": backend if isinstance(backend, dict) else {},
        "dataset": _dataset_readiness(),
        "run": run if isinstance(run, dict) else {},
        "request": _training_request_payload(TrainingStartRequest(model=_default_training_model(training_models))),
        "training_models": training_models,
    }


def _unwrap_image_pool_http_exception(exc: HTTPException) -> HTTPException:
    detail = exc.detail
    if isinstance(detail, dict) and isinstance(detail.get("detail"), dict):
        detail = detail["detail"]
    return HTTPException(status_code=exc.status_code, detail=detail)


def _download_image(entry: dict[str, str]) -> bool:
    image_path = _image_path(entry)
    if image_path.exists():
        return False

    image_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with request.urlopen(entry["image_url"], timeout=60.0) as response:
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

    temp_path = image_path.with_suffix(f"{image_path.suffix}.tmp")
    temp_path.write_bytes(content)
    temp_path.replace(image_path)
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


@router.get("/flux2-klein/bfl-graphic-impressions")
def get_flux2_klein_training_dataset() -> dict[str, object]:
    return _dataset_payload()


@router.post("/flux2-klein/bfl-graphic-impressions/download")
def download_flux2_klein_training_dataset() -> dict[str, object]:
    downloaded_now = 0
    existing = 0
    for entry in _entries():
        if _download_image(entry):
            downloaded_now += 1
        else:
            existing += 1
    payload = _dataset_payload()
    payload["downloaded_now"] = downloaded_now
    payload["existing"] = existing
    return payload


@router.get("/flux2-klein/bfl-graphic-impressions/run")
def get_flux2_klein_training_run() -> dict[str, object]:
    return _training_status_payload()


@router.post("/flux2-klein/bfl-graphic-impressions/run")
def start_flux2_klein_training_run(start_request: TrainingStartRequest) -> dict[str, object]:
    _require_dataset_ready()
    try:
        _request_image_pool_json(
            method="POST",
            path="/v1/training/flux-lora",
            payload=_training_request_payload(start_request),
            timeout=30.0,
        )
    except HTTPException as exc:
        raise _unwrap_image_pool_http_exception(exc) from exc
    return _training_status_payload()


@router.post("/flux2-klein/bfl-graphic-impressions/stop")
def stop_flux2_klein_training_run() -> dict[str, object]:
    try:
        _request_image_pool_json(
            method="POST",
            path="/v1/training/flux-lora/stop",
            timeout=10.0,
        )
    except HTTPException as exc:
        raise _unwrap_image_pool_http_exception(exc) from exc
    return _training_status_payload()


@router.post("/flux2-klein/bfl-graphic-impressions/caption")
def caption_flux2_klein_training_image(caption_request: CaptionRequest) -> dict[str, object]:
    model = caption_request.model.strip()
    if model == "":
        raise HTTPException(status_code=400, detail="Model must not be empty.")

    trigger_word = caption_request.trigger_word.strip() or TRIGGER_WORD
    caption_prompt = (caption_request.caption_prompt or _caption_prompt(trigger_word)).strip()
    system_prompt = caption_request.system_prompt.strip() or DEFAULT_CAPTION_SYSTEM_PROMPT
    if caption_prompt == "":
        raise HTTPException(status_code=400, detail="Caption prompt must not be empty.")
    entry = _find_entry(caption_request.image_id)
    _download_image(entry)

    caption_path = _caption_path(entry)
    if caption_path.exists() and not caption_request.overwrite:
        return {"image": _image_status(entry), "caption": _read_caption(caption_path)}

    try:
        response_json, transport_completed_ms = _run_prompt_runner_payload(
            _caption_payload(
                model,
                caption_prompt=caption_prompt,
                system_prompt=system_prompt,
                image_data_url=_image_data_url(_image_path(entry)),
            )
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    caption = _normalize_caption(str(response_json.get("output_text") or ""), trigger_word)
    caption_path.parent.mkdir(parents=True, exist_ok=True)
    caption_path.write_text(f"{caption}\n", encoding="utf-8")
    metrics = response_json.get("metrics", {})
    if not isinstance(metrics, dict):
        metrics = {}
    return {
        "image": _image_status(entry),
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
