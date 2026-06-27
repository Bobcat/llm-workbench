from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.image_pool import models as image_pool_models
from app.image_pool import loras as image_pool_loras
from app.main import app


class ImagePoolApiTests(unittest.TestCase):
    def test_base_url_uses_local_settings_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            settings_path.write_text(
                '{\n'
                '  "image_pool": {"base_url": "http://settings:8013"}\n'
                '}\n',
                encoding="utf-8",
            )
            settings_path.with_name("local.json").write_text(
                '{\n'
                '  "image_pool": {"base_url": "http://local:8013"}\n'
                '}\n',
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {}, clear=True):
                with mock.patch.object(image_pool_models, "DEFAULT_SETTINGS_PATH", settings_path):
                    self.assertEqual(image_pool_models._image_pool_base_url(), "http://local:8013")

    def test_base_url_env_override_wins_over_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            settings_path.write_text(
                '{\n'
                '  "image_pool": {"base_url": "http://settings:8013"}\n'
                '}\n',
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {"IMAGE_POOL_API_BASE_URL": "http://env:8013"}, clear=True):
                with mock.patch.object(image_pool_models, "DEFAULT_SETTINGS_PATH", settings_path):
                    self.assertEqual(image_pool_models._image_pool_base_url(), "http://env:8013")

    def test_models_endpoint_uses_public_model_ids(self) -> None:
        client = TestClient(app)

        stub_capabilities = {
            "tasks": ["image_generation", "image_edit"],
            "input_modalities": ["text", "image"],
            "output_modalities": ["image"],
        }
        with mock.patch(
            "app.image_pool.models._request_json",
            return_value={
                "object": "list",
                "data": [
                    {
                        "id": "stub-image",
                        "object": "model",
                        "backend": "stub",
                        "capabilities": stub_capabilities,
                        "recommended_steps": 4,
                        "recommended_guidance": 1.0,
                    },
                    {"id": "qwen-image-edit", "object": "model"},
                ],
            },
        ) as request_json:
            response = client.get("/api/image-pool/models")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            [
                {
                    "id": "stub-image",
                    "name": "stub-image",
                    "backend": "stub",
                    "capabilities": stub_capabilities,
                    "recommended_steps": 4,
                    "recommended_guidance": 1.0,
                },
                {
                    "id": "qwen-image-edit",
                    "name": "qwen-image-edit",
                    "backend": "",
                    "capabilities": {},
                    "recommended_steps": None,
                    "recommended_guidance": None,
                },
            ],
        )
        request_json.assert_called_once_with(method="GET", path="/v1/models", timeout=2.0)

    def test_admin_models_endpoint_normalizes_image_pool_fields(self) -> None:
        client = TestClient(app)

        admin_payload = {
            "object": "list",
            "data": [
                {
                    "id": "stub-image",
                    "backend": "stub",
                    "enabled": True,
                    "loaded": True,
                    "loading": False,
                    "last_error": None,
                    "scheduler": {"target_inflight": 1, "inflight": 1, "queued": 2},
                    "vram_estimate_mib": 0,
                    "recommended_steps": 4,
                    "recommended_guidance": 1.0,
                    "capabilities": {
                        "tasks": ["image_generation", "image_edit"],
                        "input_modalities": ["text", "image"],
                        "output_modalities": ["image"],
                    },
                    "model_path": None,
                }
            ],
        }

        with mock.patch("app.image_pool.models._request_json", return_value=admin_payload) as request_json:
            response = client.get("/api/image-pool/models/admin")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["models"][0]["name"], "stub-image")
        self.assertEqual(payload["models"][0]["runtime_state"], "loaded")
        self.assertEqual(payload["models"][0]["queue_depth"], 2)
        self.assertEqual(payload["models"][0]["configured_target_inflight"], 1)
        self.assertEqual(payload["models"][0]["capabilities"]["tasks"], ["image_generation", "image_edit"])
        self.assertEqual(payload["models"][0]["definition"]["recommended_steps"], 4)
        self.assertEqual(payload["models"][0]["definition"]["recommended_guidance"], 1.0)
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
                "id": "stub-image",
                "backend": "stub",
                "enabled": True,
                "loaded": True,
                "scheduler": {"target_inflight": 2, "inflight": 0, "queued": 0},
            }

        with mock.patch("app.image_pool.models._request_json", side_effect=fake_request_json):
            response = client.post("/api/image-pool/models/admin/stub-image/load", json={"target_inflight": 2})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["path"], "/v1/admin/models/stub-image/load")
        self.assertEqual(captured["timeout"], 30.0)
        self.assertEqual(captured["payload"], {"target_inflight": 2})
        self.assertEqual(response.json()["configured_target_inflight"], 2)

    def test_image_generation_forwards_json_payload(self) -> None:
        client = TestClient(app)
        captured: dict[str, object] = {}

        def fake_request_json(*, method: str, path: str, payload: dict | None = None, timeout: float = 0.0) -> dict:
            captured["method"] = method
            captured["path"] = path
            captured["payload"] = payload
            captured["timeout"] = timeout
            return {"object": "image.generation", "data": []}

        request_payload = {"model": "stub-image", "prompt": "test", "size": "512x512"}
        with mock.patch("app.image_pool.models._request_json", side_effect=fake_request_json):
            response = client.post("/api/image-pool/images/generations", json=request_payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["object"], "image.generation")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["path"], "/v1/images/generations")
        self.assertEqual(captured["payload"], request_payload)
        self.assertEqual(captured["timeout"], 120.0)

    def test_loras_endpoint_lists_training_run_weights(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            runs_root = Path(tmpdir) / "runs"
            run_dir = runs_root / "20260626-162634"
            run_dir.mkdir(parents=True)
            weight_path = run_dir / "pytorch_lora_weights.safetensors"
            weight_path.write_bytes(b"lora")
            checkpoint_path = run_dir / "checkpoints" / "step-002000" / "pytorch_lora_weights.safetensors"
            checkpoint_path.parent.mkdir(parents=True)
            checkpoint_path.write_bytes(b"checkpoint lora")
            (run_dir / "request.json").write_text(
                json.dumps(
                    {
                        "model": "flux2-klein-base-4b",
                        "metadata": {"dataset": "bfl-graphic-impressions"},
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch.object(image_pool_loras, "TRAINING_RUNS_ROOT", runs_root):
                with mock.patch.object(image_pool_loras, "Z_IMAGE_TRAINING_RUNS_ROOT", Path(tmpdir) / "z-runs"):
                    response = client.get("/api/image-pool/loras")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["loras"]), 2)
        self.assertEqual(payload["loras"][0]["model"], "flux2-klein-base-4b")
        self.assertEqual(payload["loras"][0]["compatible_models"], ["flux2-klein-base-4b", "flux2-klein-4b"])
        self.assertEqual(payload["loras"][0]["run_id"], "20260626-162634")
        self.assertEqual(payload["loras"][0]["path"], str(weight_path.resolve()))
        self.assertEqual(payload["loras"][0]["kind"], "final")
        self.assertEqual(payload["loras"][1]["kind"], "checkpoint")
        self.assertEqual(payload["loras"][1]["checkpoint_id"], "step-002000")
        self.assertEqual(payload["loras"][1]["checkpoint_step"], 2000)
        self.assertEqual(payload["loras"][1]["path"], str(checkpoint_path.resolve()))

    def test_loras_endpoint_lists_z_image_weights(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            flux_root = root / "flux-runs"
            z_root = root / "z-runs"
            run_dir = z_root / "20260627-153000"
            run_dir.mkdir(parents=True)
            weight_path = run_dir / "pytorch_lora_weights.safetensors"
            weight_path.write_bytes(b"z-lora")
            (run_dir / "request.json").write_text(
                json.dumps(
                    {
                        "model": "z-image-base",
                        "metadata": {"dataset": "custom-set", "trainer": "z-image"},
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch.object(image_pool_loras, "TRAINING_RUNS_ROOT", flux_root):
                with mock.patch.object(image_pool_loras, "Z_IMAGE_TRAINING_RUNS_ROOT", z_root):
                    response = client.get("/api/image-pool/loras")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["loras"]), 1)
        self.assertEqual(payload["loras"][0]["id"], "z-image/custom-set/20260627-153000")
        self.assertEqual(payload["loras"][0]["compatible_models"], ["z-image-base", "z-image-turbo"])

    def test_image_edit_forwards_json_payload(self) -> None:
        client = TestClient(app)
        captured: dict[str, object] = {}

        def fake_request_json(*, method: str, path: str, payload: dict | None = None, timeout: float = 0.0) -> dict:
            captured["method"] = method
            captured["path"] = path
            captured["payload"] = payload
            captured["timeout"] = timeout
            return {"object": "image.edit", "data": []}

        request_payload = {
            "model": "stub-image",
            "prompt": "edit",
            "size": "512x512",
            "images": [{"name": "input.png", "data_url": "data:image/png;base64,iVBORw0KGgo="}],
        }
        with mock.patch("app.image_pool.models._request_json", side_effect=fake_request_json):
            response = client.post("/api/image-pool/images/edits", json=request_payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["object"], "image.edit")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["path"], "/v1/images/edits")
        self.assertEqual(captured["payload"], request_payload)
        self.assertEqual(captured["timeout"], 120.0)


if __name__ == "__main__":
    unittest.main()
