from __future__ import annotations

import shutil
import uuid
import wave
from pathlib import Path

from realtime_tts_engine import TTSEngine
from realtime_tts_engine import TTSRequest
from realtime_tts_engine.kokoro import KokoroSynthesizer

REPO_ROOT = Path(__file__).resolve().parents[3]
TTS_ARTIFACT_ROOT = REPO_ROOT / "data" / "realtime_translation" / "tts_artifacts"
KOKORO_MODEL_ROOT = Path.home() / ".cache" / "llm-workbench" / "tts-models" / "kokoro-82m"

_ENGINE: TTSEngine | None = None


def _engine() -> TTSEngine:
    global _ENGINE
    if _ENGINE is None:
        _ENGINE = TTSEngine(KokoroSynthesizer(model_root=KOKORO_MODEL_ROOT))
    return _ENGINE


def replay_tts_artifact_path(session_id: str, artifact_id: str) -> Path:
    safe_session_id = _safe_path_token(session_id)
    safe_artifact_id = _safe_path_token(artifact_id)
    return (TTS_ARTIFACT_ROOT / safe_session_id / f"{safe_artifact_id}.wav").resolve()


def replay_tts_combined_artifact_path(session_id: str) -> Path:
    safe_session_id = _safe_path_token(session_id)
    return (TTS_ARTIFACT_ROOT / safe_session_id / "tts_combined.wav").resolve()


def replay_tts_combined_payload(session_id: str, artifacts: list[dict[str, object]]) -> dict[str, object]:
    safe_session_id = _safe_path_token(session_id)
    last_artifact_id = ""
    if artifacts:
        last_artifact_id = _safe_path_token(str(artifacts[-1].get("artifact_id", "")))
    return {
        "url": f"/api/replay/{safe_session_id}/tts-combined?last={last_artifact_id}",
        "mime_type": "audio/wav",
        "artifact_count": len(artifacts),
    }


def clear_replay_tts_artifacts(session_id: str) -> None:
    safe_session_id = _safe_path_token(session_id)
    artifact_dir = (TTS_ARTIFACT_ROOT / safe_session_id).resolve()
    if artifact_dir.exists() and artifact_dir.is_dir():
        shutil.rmtree(artifact_dir)


def synthesize_replay_tts(*, session_id: str, text: str, language: str) -> dict[str, object]:
    safe_text = str(text or "").strip()
    safe_language = str(language or "").strip()
    if not safe_text:
        raise ValueError("TTS text must not be empty")
    if not safe_language:
        raise ValueError("TTS language must not be empty")

    artifact_id = f"tts_{uuid.uuid4().hex}"
    artifact_path = replay_tts_artifact_path(session_id, artifact_id)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)

    result = _engine().synthesize(TTSRequest(text=safe_text, language=safe_language))
    artifact_path.write_bytes(result.audio)
    metadata = dict(result.metadata)
    return {
        "artifact_id": artifact_id,
        "url": f"/api/replay/{_safe_path_token(session_id)}/tts/{artifact_id}",
        "mime_type": result.mime_type,
        "sample_rate_hz": result.sample_rate_hz,
        "duration_ms": result.duration_ms,
        "timings": dict(result.timings),
        "engine": metadata.get("engine"),
        "voice": metadata.get("voice"),
        "language_code": metadata.get("language_code"),
        "chars": len(safe_text),
        "language": safe_language,
    }


def build_replay_tts_combined_artifact(*, session_id: str, artifacts: list[dict[str, object]]) -> dict[str, object]:
    if not artifacts:
        raise ValueError("No TTS artifacts available")

    output_path = replay_tts_combined_artifact_path(session_id)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_name(f"{output_path.name}.tmp")

    params = None
    total_frames = 0
    artifact_count = 0
    with wave.open(str(tmp_path), "wb") as writer:
        for artifact in artifacts:
            artifact_id = _safe_path_token(str(artifact.get("artifact_id", "")))
            source_path = replay_tts_artifact_path(session_id, artifact_id)
            if not source_path.exists():
                raise ValueError(f"TTS artifact missing: {artifact_id}")
            with wave.open(str(source_path), "rb") as reader:
                current_params = (
                    reader.getnchannels(),
                    reader.getsampwidth(),
                    reader.getframerate(),
                    reader.getcomptype(),
                    reader.getcompname(),
                )
                if params is None:
                    params = current_params
                    writer.setnchannels(reader.getnchannels())
                    writer.setsampwidth(reader.getsampwidth())
                    writer.setframerate(reader.getframerate())
                elif current_params != params:
                    raise ValueError(f"TTS artifact format mismatch: {artifact_id}")

                while True:
                    frames = reader.readframes(8192)
                    if not frames:
                        break
                    writer.writeframes(frames)
                total_frames += reader.getnframes()
                artifact_count += 1

    if params is None or artifact_count == 0:
        raise ValueError("No TTS artifacts available")

    tmp_path.replace(output_path)
    sample_rate_hz = int(params[2])
    return {
        **replay_tts_combined_payload(session_id, artifacts),
        "sample_rate_hz": sample_rate_hz,
        "duration_ms": int(total_frames / sample_rate_hz * 1000),
        "artifact_count": artifact_count,
    }


def _safe_path_token(value: str) -> str:
    token = str(value or "").strip()
    if not token:
        raise ValueError("empty path token")
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
    if any(ch not in allowed for ch in token):
        raise ValueError(f"unsafe path token: {token!r}")
    return token
