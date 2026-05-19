from __future__ import annotations

import os
import tempfile
from pathlib import Path
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.main import app
from app.tts_pool import models as tts_pool_models


class TtsPoolApiTests(unittest.TestCase):
    def test_base_url_uses_local_settings_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            settings_path.write_text(
                '{\n'
                '  "tts_pool": {"base_url": "http://settings:8020"}\n'
                '}\n',
                encoding="utf-8",
            )
            settings_path.with_name("local.json").write_text(
                '{\n'
                '  "tts_pool": {"base_url": "http://local:8020"}\n'
                '}\n',
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {}, clear=True):
                with mock.patch.object(tts_pool_models, "DEFAULT_SETTINGS_PATH", settings_path):
                    self.assertEqual(tts_pool_models._tts_pool_base_url(), "http://local:8020")

    def test_base_url_env_override_wins_over_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            settings_path.write_text(
                '{\n'
                '  "tts_pool": {"base_url": "http://settings:8020"}\n'
                '}\n',
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {"TTS_POOL_API_BASE_URL": "http://env:8020"}, clear=True):
                with mock.patch.object(tts_pool_models, "DEFAULT_SETTINGS_PATH", settings_path):
                    self.assertEqual(tts_pool_models._tts_pool_base_url(), "http://env:8020")

    def test_models_endpoint_uses_public_model_ids(self) -> None:
        client = TestClient(app)

        with mock.patch(
            "app.tts_pool.models._request_json",
            return_value={"models": ["kokoro", "nanovllm-voxcpm"]},
        ) as request_json:
            response = client.get("/api/tts-pool/models")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            [
                {"id": "kokoro", "name": "kokoro"},
                {"id": "nanovllm-voxcpm", "name": "nanovllm-voxcpm"},
            ],
        )
        request_json.assert_called_once_with(method="GET", path="/v1/models", timeout=2.0)

    def test_admin_models_endpoint_preserves_tts_pool_fields(self) -> None:
        client = TestClient(app)

        admin_payload = {
            "models": [
                {
                    "name": "nanovllm-voxcpm",
                    "resolved_backend": "nanovllm_voxcpm",
                    "configured_enabled": True,
                    "runtime_state": "loaded",
                    "is_loaded": True,
                    "inflight_requests": 1,
                    "queue_depth": 2,
                    "configured_target_inflight": 1,
                    "effective_target_inflight": 1,
                    "last_error": None,
                    "vram_estimate_mib": 22000,
                    "vram_estimate_source": "model_artifact_size",
                    "capabilities": {
                        "output_formats": ["wav"],
                        "voice_instructions": True,
                        "reference_audio": True,
                        "streaming": False,
                    },
                    "definition": {
                        "model_path": "/models/nanovllm",
                        "backend": "nanovllm_voxcpm",
                        "enabled": True,
                        "target_inflight": 1,
                    },
                }
            ]
        }

        with mock.patch("app.tts_pool.models._request_json", return_value=admin_payload) as request_json:
            response = client.get("/api/tts-pool/models/admin")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["models"][0]["name"], "nanovllm-voxcpm")
        self.assertEqual(payload["models"][0]["queue_depth"], 2)
        self.assertEqual(payload["models"][0]["configured_target_inflight"], 1)
        self.assertTrue(payload["models"][0]["capabilities"]["reference_audio"])
        request_json.assert_called_once_with(method="GET", path="/v1/admin/models", timeout=3.0)

    def test_load_admin_model_forwards_target_inflight(self) -> None:
        client = TestClient(app)
        captured: dict[str, object] = {}

        def fake_request_json(*, method: str, path: str, payload: dict | None = None, timeout: float = 0.0) -> dict:
            captured["method"] = method
            captured["path"] = path
            captured["payload"] = payload
            captured["timeout"] = timeout
            return {
                "name": "kokoro",
                "resolved_backend": "kokoro",
                "configured_enabled": True,
                "runtime_state": "loaded",
                "is_loaded": True,
                "inflight_requests": 0,
                "queue_depth": 0,
                "configured_target_inflight": 2,
                "effective_target_inflight": 2,
                "last_error": None,
                "vram_estimate_mib": 1200,
                "vram_estimate_source": "model_artifact_size",
                "capabilities": {"output_formats": ["wav"], "streaming": False},
                "definition": {"backend": "kokoro", "target_inflight": 1},
            }

        with mock.patch("app.tts_pool.models._request_json", side_effect=fake_request_json):
            response = client.post("/api/tts-pool/models/admin/kokoro/load", json={"target_inflight": 2})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["path"], "/v1/admin/models/kokoro/load")
        self.assertEqual(captured["timeout"], 30.0)
        self.assertEqual(captured["payload"], {"target_inflight": 2})
        self.assertEqual(response.json()["configured_target_inflight"], 2)


if __name__ == "__main__":
    unittest.main()
