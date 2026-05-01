from __future__ import annotations

import asyncio
import unittest
import wave
from io import BytesIO
from unittest import mock

from fastapi.testclient import TestClient

from app.main import app
from app.realtime_translation.replay.sessions import _sessions
from app.realtime_translation.replay.transport import _send_state_update
from app.realtime_translation.replay.transport import _send_target_update
from app.realtime_translation.replay.tts import synthesize_replay_tts
from realtime_tts_engine import TTSResult


def _wav_bytes(*, frame_count: int, sample_rate_hz: int = 24000) -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate_hz)
        wav.writeframes(b"\x00\x00" * frame_count)
    return buffer.getvalue()


class FakeWebSocket:
    def __init__(self) -> None:
        self.messages: list[dict[str, object]] = []

    async def send_json(self, message: dict[str, object]) -> None:
        self.messages.append(message)


class ReplayApiTests(unittest.TestCase):
    def test_create_session_resolves_relative_sample_path_from_repo_root(self) -> None:
        client = TestClient(app)

        response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("session_id", payload)
        self.assertNotIn("error", payload)
        self.assertEqual(
            payload.get("second_pass_prompt_id"),
            "translation/second-pass/current-default",
        )

    def test_list_sample_files_returns_pc_files(self) -> None:
        client = TestClient(app)

        response = client.get("/api/replay/samples")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("samples", payload)
        sample_names = [item["name"] for item in payload["samples"]]
        self.assertIn("sample_p_c_120s.pc", sample_names)
        self.assertIn("sample_c_only_120s.pc", sample_names)

    def test_set_second_pass_prompt_accepts_second_pass_prompt(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]

        response = client.post(
            f"/api/replay/{session_id}/second-pass-prompt",
            json={"prompt_id": "translation/second-pass/current-default"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "ok")
        self.assertEqual(payload.get("prompt_id"), "translation/second-pass/current-default")

    def test_set_second_pass_model_uses_second_pass_backend_terms(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]

        response = client.post(
            f"/api/replay/{session_id}/second-pass-model",
            json={"model": "google_gemma-4-E4B-it-Q5_K_M-gguf"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "ok")
        self.assertEqual(payload.get("second_pass_model"), "google_gemma-4-E4B-it-Q5_K_M-gguf")
        self.assertTrue(payload.get("second_pass_enabled"))

    def test_set_tts_updates_session(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]

        response = client.post(
            f"/api/replay/{session_id}/tts",
            json={"enabled": True},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "ok")
        self.assertTrue(payload.get("tts_enabled"))
        self.assertTrue(_sessions[session_id].tts_enabled)

    def test_get_tts_artifact_serves_generated_wav(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]

        with mock.patch("app.realtime_translation.replay.tts._engine") as engine_factory:
            engine_factory.return_value.synthesize.return_value = TTSResult(
                audio=_wav_bytes(frame_count=1200),
                mime_type="audio/wav",
                sample_rate_hz=24000,
                duration_ms=100,
                timings={"ttfa_s": 0.01, "total_s": 0.02},
                metadata={"engine": "kokoro", "voice": "af_heart", "language_code": "a"},
            )
            artifact = synthesize_replay_tts(
                session_id=session_id,
                text="Hello world.",
                language="English",
            )
        self.assertEqual(artifact["engine"], "kokoro")
        self.assertEqual(artifact["voice"], "af_heart")
        self.assertEqual(artifact["language_code"], "a")
        self.assertEqual(artifact["timings"]["ttfa_s"], 0.01)
        response = client.get(str(artifact["url"]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("content-type"), "audio/wav")
        self.assertTrue(response.headers.get("content-disposition", "").startswith("inline;"))
        self.assertGreater(len(response.content), 44)

    def test_get_tts_combined_artifact_concatenates_session_wavs(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]
        session = _sessions[session_id]

        audio_results = [
            TTSResult(audio=_wav_bytes(frame_count=1000), sample_rate_hz=24000, duration_ms=41),
            TTSResult(audio=_wav_bytes(frame_count=2000), sample_rate_hz=24000, duration_ms=83),
        ]
        with mock.patch("app.realtime_translation.replay.tts._engine") as engine_factory:
            engine_factory.return_value.synthesize.side_effect = audio_results
            first = synthesize_replay_tts(session_id=session_id, text="Hello.", language="English")
            second = synthesize_replay_tts(session_id=session_id, text="World.", language="English")
        session.tts_artifacts.extend([dict(first), dict(second)])

        response = client.get(f"/api/replay/{session_id}/tts-combined")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("content-type"), "audio/wav")
        self.assertTrue(response.headers.get("content-disposition", "").startswith("inline;"))
        self.assertEqual(response.headers.get("x-tts-artifact-count"), "2")
        with wave.open(BytesIO(response.content), "rb") as wav:
            self.assertEqual(wav.getframerate(), 24000)
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getnframes(), 3000)

    def test_completed_state_update_prepares_tts_combined_payload(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]
        session = _sessions[session_id]
        session.websocket = FakeWebSocket()
        session.current_event_index = len(session.events) + 1

        audio_results = [
            TTSResult(audio=_wav_bytes(frame_count=1000), sample_rate_hz=24000, duration_ms=41),
            TTSResult(audio=_wav_bytes(frame_count=2000), sample_rate_hz=24000, duration_ms=83),
        ]
        with mock.patch("app.realtime_translation.replay.tts._engine") as engine_factory:
            engine_factory.return_value.synthesize.side_effect = audio_results
            first = synthesize_replay_tts(session_id=session_id, text="Hello.", language="English")
            second = synthesize_replay_tts(session_id=session_id, text="World.", language="English")
        session.tts_artifacts.extend([dict(first), dict(second)])

        asyncio.run(_send_state_update(session, "completed"))

        self.assertEqual(len(session.websocket.messages), 1)
        payload = session.websocket.messages[0]["data"]["tts_combined"]
        self.assertEqual(payload["artifact_count"], 2)
        self.assertEqual(payload["duration_ms"], 125)
        self.assertTrue(payload["url"].startswith(f"/api/replay/{session_id}/tts-combined"))

    def test_tts_error_does_not_break_target_update(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]
        session = _sessions[session_id]
        websocket = FakeWebSocket()
        session.websocket = websocket
        session.tts_enabled = True
        session.target_committed_text = "Hallo wereld."
        session.target_language = "Dutch"

        with mock.patch(
            "app.realtime_translation.replay.transport.synthesize_replay_tts",
            side_effect=ValueError("unsupported Kokoro language 'Dutch'"),
        ):
            asyncio.run(_send_target_update(
                session,
                event_index=1,
                triggered=True,
                reason="test",
                wall_ms=1.0,
            ))

        self.assertIs(session.websocket, websocket)
        self.assertEqual(len(websocket.messages), 1)
        payload = websocket.messages[0]["data"]
        self.assertEqual(payload["committed_append"], "Hallo wereld.")
        self.assertIsNone(payload["tts"])
        self.assertIn("unsupported Kokoro language", payload["tts_error"])
        self.assertEqual(session.tts_artifacts, [])

    def test_replay_websocket_uses_delta_transcript_updates(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]

        speed_response = client.post(
            f"/api/replay/{session_id}/speed",
            json={"speed": "fast7"},
        )
        self.assertEqual(speed_response.status_code, 200)

        with client.websocket_connect(f"/ws/replay/{session_id}") as websocket:
            session_info = websocket.receive_json()
            self.assertEqual(session_info["type"], "session_info")
            self.assertIn("second_pass_model", session_info["data"])
            self.assertIn("second_pass_enabled", session_info["data"])

            source_update = websocket.receive_json()
            self.assertEqual(source_update["type"], "source_update")
            self.assertTrue(source_update["data"]["reset"])
            self.assertIn("committed_append", source_update["data"])
            self.assertNotIn("committed", source_update["data"])

            target_update = websocket.receive_json()
            self.assertEqual(target_update["type"], "target_update")
            self.assertTrue(target_update["data"]["reset"])
            self.assertIn("committed_append", target_update["data"])
            self.assertNotIn("committed", target_update["data"])

            start_response = client.post(f"/api/replay/{session_id}/start")
            self.assertEqual(start_response.status_code, 200)

            playing_source_update = None
            translation_outcome = None
            for _ in range(10):
                message = websocket.receive_json()
                if message["type"] == "source_update" and message["data"].get("status") == "playing":
                    playing_source_update = message
                if message["type"] == "translation_outcome":
                    translation_outcome = message
                if playing_source_update is not None and translation_outcome is not None:
                    break

            self.assertIsNotNone(playing_source_update)
            self.assertIn("committed_append", playing_source_update["data"])
            self.assertNotIn("committed", playing_source_update["data"])
            self.assertIsNotNone(translation_outcome)
            self.assertIn("translated", translation_outcome["data"])
            self.assertIn("request_executed", translation_outcome["data"])
            self.assertIn("event_kind", translation_outcome["data"])

    def test_export_includes_gguf_runtime_settings(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]
        session = _sessions[session_id]
        session.model = "google_gemma-4-E2B-it-Q8_0-gguf"
        session.models_used = {"google_gemma-4-E2B-it-Q8_0-gguf"}
        session.source_committed_text = "source text"
        session.target_committed_text = "target text"

        with mock.patch(
            "app.realtime_translation.replay.export_runtime._llm_pool_request_json",
            return_value={
                "models": [
                    {
                        "name": "google_gemma-4-E2B-it-Q8_0-gguf",
                        "resolved_backend": "gguf",
                        "definition": {
                            "gguf_n_ctx": 16384,
                            "gguf_flash_attn": "auto",
                            "gguf_type_k": None,
                            "gguf_type_v": None,
                        },
                        "load_override": {
                            "gguf_flash_attn": "on",
                            "gguf_type_k": "q4_0",
                            "gguf_type_v": "q4_0",
                        },
                        "load_constraints": {
                            "gguf_type_k": {"default": "f16"},
                            "gguf_type_v": {"default": "f16"},
                            "gguf_flash_attn": {"default": "auto"},
                        },
                    }
                ]
            },
        ):
            response = client.get(f"/api/replay/{session_id}/export")

        self.assertEqual(response.status_code, 200)
        content = response.text
        self.assertIn("Model backend: gguf", content)
        self.assertIn("Model context size: 16384", content)
        self.assertIn("Model flash attn: on", content)
        self.assertIn("Model K type: q4_0", content)
        self.assertIn("Model V type: q4_0", content)


if __name__ == "__main__":
    unittest.main()
