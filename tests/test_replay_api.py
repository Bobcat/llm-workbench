from __future__ import annotations

import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.main import app
from app.realtime_translation.replay.sessions import _sessions


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
