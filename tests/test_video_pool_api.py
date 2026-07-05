from __future__ import annotations

import os
import tempfile
from pathlib import Path
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.main import app
from app.video_pool import models as video_pool_models


class VideoPoolApiTests(unittest.TestCase):
    def test_base_url_uses_local_settings_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            settings_path.write_text(
                '{\n'
                '  "video_pool": {"base_url": "http://settings:8014"}\n'
                '}\n',
                encoding="utf-8",
            )
            settings_path.with_name("local.json").write_text(
                '{\n'
                '  "video_pool": {"base_url": "http://local:8014"}\n'
                '}\n',
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {}, clear=True):
                with mock.patch.object(video_pool_models, "DEFAULT_SETTINGS_PATH", settings_path):
                    self.assertEqual(video_pool_models._video_pool_base_url(), "http://local:8014")

    def test_base_url_env_override_wins_over_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            settings_path.write_text(
                '{\n'
                '  "video_pool": {"base_url": "http://settings:8014"}\n'
                '}\n',
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {"VIDEO_POOL_API_BASE_URL": "http://env:8014"}, clear=True):
                with mock.patch.object(video_pool_models, "DEFAULT_SETTINGS_PATH", settings_path):
                    self.assertEqual(video_pool_models._video_pool_base_url(), "http://env:8014")

    def test_models_endpoint_uses_public_model_ids(self) -> None:
        client = TestClient(app)

        capabilities = {
            "tasks": ["text_to_video", "image_to_video"],
            "input_modalities": ["text", "image"],
            "output_modalities": ["video"],
            "max_images": 1,
            "max_output_videos": 1,
        }
        generation_parameters = {
            "steps": {"kind": "integer", "target": "metadata", "default": 4},
        }
        image_to_video_parameters = {
            "duration_seconds": {"kind": "number", "target": "request", "default": 5.0},
        }
        with mock.patch(
            "app.video_pool.models._request_json",
            return_value={
                "object": "list",
                "data": [
                    {
                        "id": "stub-video",
                        "object": "model",
                        "backend": "stub",
                        "capabilities": capabilities,
                        "recommended_steps": 4,
                        "recommended_guidance": 1.0,
                        "generation_parameters": generation_parameters,
                        "image_to_video_parameters": image_to_video_parameters,
                    },
                ],
            },
        ) as request_json:
            response = client.get("/api/video-pool/models")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            [
                {
                    "id": "stub-video",
                    "name": "stub-video",
                    "backend": "stub",
                    "capabilities": capabilities,
                    "recommended_steps": 4,
                    "recommended_guidance": 1.0,
                    "generation_parameters": generation_parameters,
                    "image_to_video_parameters": image_to_video_parameters,
                },
            ],
        )
        request_json.assert_called_once_with(method="GET", path="/v1/models", timeout=2.0)

    def test_admin_models_endpoint_normalizes_video_pool_fields(self) -> None:
        client = TestClient(app)

        admin_payload = {
            "object": "list",
            "data": [
                {
                    "id": "stub-video",
                    "backend": "stub",
                    "enabled": True,
                    "loaded": True,
                    "loading": False,
                    "last_error": None,
                    "scheduler": {"target_inflight": 1, "inflight": 1, "queued": 2},
                    "vram_estimate_mib": 0,
                    "recommended_steps": 4,
                    "recommended_guidance": 1.0,
                    "generation_parameters": {
                        "steps": {"kind": "integer", "target": "metadata", "default": 4},
                    },
                    "image_to_video_parameters": {
                        "duration_seconds": {"kind": "number", "target": "request", "default": 5.0},
                    },
                    "capabilities": {
                        "tasks": ["text_to_video", "image_to_video"],
                        "input_modalities": ["text", "image"],
                        "output_modalities": ["video"],
                    },
                    "model_path": None,
                }
            ],
        }

        with mock.patch("app.video_pool.models._request_json", return_value=admin_payload) as request_json:
            response = client.get("/api/video-pool/models/admin")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["models"][0]["name"], "stub-video")
        self.assertEqual(payload["models"][0]["runtime_state"], "loaded")
        self.assertEqual(payload["models"][0]["queue_depth"], 2)
        self.assertEqual(payload["models"][0]["configured_target_inflight"], 1)
        self.assertEqual(payload["models"][0]["capabilities"]["tasks"], ["text_to_video", "image_to_video"])
        self.assertEqual(payload["models"][0]["definition"]["recommended_steps"], 4)
        self.assertEqual(payload["models"][0]["definition"]["recommended_guidance"], 1.0)
        self.assertEqual(payload["models"][0]["generation_parameters"]["steps"]["default"], 4)
        self.assertEqual(payload["models"][0]["image_to_video_parameters"]["duration_seconds"]["default"], 5.0)
        request_json.assert_called_once_with(method="GET", path="/v1/admin/models", timeout=3.0)

    def test_video_generation_forwards_payload_and_rewrites_artifact_url(self) -> None:
        client = TestClient(app)
        captured: dict[str, object] = {}

        def fake_request_json(*, method: str, path: str, payload: dict | None = None, timeout: float = 0.0) -> dict:
            captured["method"] = method
            captured["path"] = path
            captured["payload"] = payload
            captured["timeout"] = timeout
            return {
                "object": "video.generation",
                "data": [
                    {
                        "url": "/artifacts/video_generations/stub.json",
                        "path": "/tmp/stub.json",
                        "mime_type": "application/json",
                        "width": 832,
                        "height": 480,
                        "num_frames": 80,
                        "fps": 16,
                        "duration_seconds": 5.0,
                    }
                ],
            }

        request_payload = {"model": "stub-video", "prompt": "test", "size": "832x480"}
        with mock.patch("app.video_pool.models._request_json", side_effect=fake_request_json):
            response = client.post("/api/video-pool/videos/generations", json=request_payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["object"], "video.generation")
        self.assertEqual(response.json()["data"][0]["url"], "/api/video-pool/artifacts/video_generations/stub.json")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["path"], "/v1/videos/generations")
        self.assertEqual(captured["payload"], request_payload)
        self.assertEqual(captured["timeout"], 600.0)


if __name__ == "__main__":
    unittest.main()
