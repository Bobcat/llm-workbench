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
        generation_parameters = {
            "steps": {"kind": "integer", "target": "metadata", "default": 4},
        }
        edit_parameters = {
            "strength": {"kind": "number", "target": "metadata", "default": 0.35},
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
                        "generation_parameters": generation_parameters,
                        "edit_parameters": edit_parameters,
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
                    "generation_parameters": generation_parameters,
                    "edit_parameters": edit_parameters,
                },
                {
                    "id": "qwen-image-edit",
                    "name": "qwen-image-edit",
                    "backend": "",
                    "capabilities": {},
                    "recommended_steps": None,
                    "recommended_guidance": None,
                    "generation_parameters": {},
                    "edit_parameters": {},
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
                    "generation_parameters": {
                        "steps": {"kind": "integer", "target": "metadata", "default": 4},
                    },
                    "edit_parameters": {
                        "strength": {"kind": "number", "target": "metadata", "default": 0.35},
                    },
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
        self.assertEqual(payload["models"][0]["generation_parameters"]["steps"]["default"], 4)
        self.assertEqual(payload["models"][0]["edit_parameters"]["strength"]["default"], 0.35)
        self.assertEqual(payload["models"][0]["definition"]["generation_parameters"]["steps"]["default"], 4)
        self.assertEqual(payload["models"][0]["definition"]["edit_parameters"]["strength"]["default"], 0.35)
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
                        "trigger_word": "GFX_IMPR5N",
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch.object(image_pool_loras, "TRAINING_RUNS_ROOT", runs_root):
                with mock.patch.object(image_pool_loras, "Z_IMAGE_TRAINING_RUNS_ROOT", Path(tmpdir) / "z-runs"):
                    with mock.patch.object(image_pool_loras, "IMPORTED_LORAS_ROOT", Path(tmpdir) / "imported"):
                        with mock.patch.object(image_pool_loras, "_image_pool_loras_payload", return_value={}):
                            response = client.get("/api/image-pool/loras")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["loras"]), 2)
        self.assertEqual(payload["loras"][0]["family"], "flux2-klein")
        self.assertEqual(payload["loras"][0]["source_type"], "training_run")
        self.assertEqual(payload["loras"][0]["artifact_type"], "final")
        self.assertEqual(payload["loras"][0]["model"], "flux2-klein-base-4b")
        self.assertEqual(payload["loras"][0]["trained_on_model_id"], "flux2-klein-base-4b")
        self.assertEqual(payload["loras"][0]["compatible_models"], ["flux2-klein-base-4b", "flux2-klein-4b"])
        self.assertEqual(payload["loras"][0]["trigger_words"], ["GFX_IMPR5N"])
        self.assertEqual(payload["loras"][0]["run_id"], "20260626-162634")
        self.assertEqual(payload["loras"][0]["path"], str(weight_path.resolve()))
        self.assertEqual(payload["loras"][0]["kind"], "final")
        self.assertEqual(payload["loras"][0]["default_strength"], None)
        self.assertEqual(payload["loras"][1]["kind"], "checkpoint")
        self.assertEqual(payload["loras"][1]["artifact_type"], "checkpoint")
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
                    with mock.patch.object(image_pool_loras, "IMPORTED_LORAS_ROOT", root / "imported"):
                        with mock.patch.object(image_pool_loras, "_image_pool_loras_payload", return_value={}):
                            response = client.get("/api/image-pool/loras")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["loras"]), 1)
        self.assertEqual(payload["loras"][0]["id"], "z-image/custom-set/20260627-153000")
        self.assertEqual(payload["loras"][0]["family"], "z-image")
        self.assertEqual(payload["loras"][0]["compatible_models"], ["z-image-base", "z-image-turbo"])

    def test_loras_endpoint_lists_imported_weights(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            imported_root = root / "imported"
            lora_dir = imported_root / "external-scorpion"
            lora_dir.mkdir(parents=True)
            weight_path = lora_dir / "adapter.safetensors"
            weight_path.write_bytes(b"external lora")
            (lora_dir / "metadata.json").write_text(
                json.dumps(
                    {
                        "name": "External Scorpion",
                        "family": "sdxl",
                        "trained_on_model_id": "sdxl-base-1.0",
                        "compatible_models": ["sdxl-base-1.0"],
                        "trigger_words": ["SCORPION_STYLE"],
                        "default_strength": 0.8,
                        "description": "Imported test LoRA.",
                        "source_url": "https://example.test/lora",
                    }
                ),
                encoding="utf-8",
            )

            with mock.patch.object(image_pool_loras, "TRAINING_RUNS_ROOT", root / "flux-runs"):
                with mock.patch.object(image_pool_loras, "Z_IMAGE_TRAINING_RUNS_ROOT", root / "z-runs"):
                    with mock.patch.object(image_pool_loras, "IMPORTED_LORAS_ROOT", imported_root):
                        with mock.patch.object(image_pool_loras, "_image_pool_loras_payload", return_value={}):
                            response = client.get("/api/image-pool/loras")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["loras"]), 1)
        self.assertEqual(payload["loras"][0]["id"], "imported/external-scorpion")
        self.assertEqual(payload["loras"][0]["name"], "External Scorpion")
        self.assertEqual(payload["loras"][0]["family"], "sdxl")
        self.assertEqual(payload["loras"][0]["source_type"], "imported")
        self.assertEqual(payload["loras"][0]["artifact_type"], "imported")
        self.assertEqual(payload["loras"][0]["trained_on_model_id"], "sdxl-base-1.0")
        self.assertEqual(payload["loras"][0]["compatible_models"], ["sdxl-base-1.0"])
        self.assertEqual(payload["loras"][0]["trigger_words"], ["SCORPION_STYLE"])
        self.assertEqual(payload["loras"][0]["default_strength"], 0.8)
        self.assertEqual(payload["loras"][0]["description"], "Imported test LoRA.")
        self.assertEqual(payload["loras"][0]["source_url"], "https://example.test/lora")
        self.assertEqual(payload["loras"][0]["path"], str(weight_path.resolve()))

    def test_loras_endpoint_includes_image_pool_imported_records(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            image_pool_record = {
                "id": "imported/image-pool-lora",
                "name": "Image Pool LoRA",
                "family": "flux2-klein",
                "source_type": "imported",
                "artifact_type": "imported",
                "path": "/tmp/image-pool-lora.safetensors",
                "compatible_models": ["flux2-klein-4b"],
            }

            with mock.patch.object(image_pool_loras, "TRAINING_RUNS_ROOT", root / "flux-runs"):
                with mock.patch.object(image_pool_loras, "Z_IMAGE_TRAINING_RUNS_ROOT", root / "z-runs"):
                    with mock.patch.object(image_pool_loras, "IMPORTED_LORAS_ROOT", root / "imported"):
                        with mock.patch.object(
                            image_pool_loras,
                            "_request_image_pool_json",
                            return_value={"object": "list", "data": [image_pool_record]},
                        ):
                            response = client.get("/api/image-pool/loras")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["loras"], [image_pool_record])

    def test_loras_endpoint_forwards_image_pool_edit_schema(self) -> None:
        client = TestClient(app)

        edit_schema = {
            "fields": {
                "family": {"kind": "enum", "allowed_values": ["z-image"]},
                "compatible_models": {
                    "kind": "string_list",
                    "allowed_values_by_family": {"z-image": ["z-image-base", "z-image-turbo"]},
                },
            }
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            with mock.patch.object(image_pool_loras, "TRAINING_RUNS_ROOT", root / "flux-runs"):
                with mock.patch.object(image_pool_loras, "Z_IMAGE_TRAINING_RUNS_ROOT", root / "z-runs"):
                    with mock.patch.object(image_pool_loras, "IMPORTED_LORAS_ROOT", root / "imported"):
                        with mock.patch.object(
                            image_pool_loras,
                            "_image_pool_loras_payload",
                            return_value={"object": "list", "data": [], "edit_schema": edit_schema},
                        ):
                            response = client.get("/api/image-pool/loras")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["edit_schema"], edit_schema)

    def test_lora_inspect_upload_forwards_temp_file_to_image_pool(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            uploads_root = Path(tmpdir) / "uploads"
            with mock.patch.object(image_pool_loras, "LORA_IMPORT_UPLOADS_ROOT", uploads_root):
                with mock.patch.object(
                    image_pool_loras,
                    "_request_image_pool_json",
                    return_value={
                        "family_guess": "flux2-klein",
                        "model_options": [],
                        "warnings": [],
                    },
                ) as request_json:
                    response = client.post(
                        "/api/image-pool/loras/inspect",
                        files={"file": ("external.safetensors", b"safe", "application/octet-stream")},
                    )
                    forwarded = request_json.call_args.kwargs["payload"]
                    forwarded_exists = Path(forwarded["source_path"]).is_file()
                    forwarded_name = Path(forwarded["source_path"]).name

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertRegex(payload["upload_id"], r"^[a-f0-9]{32}$")
        self.assertTrue(forwarded_exists)
        self.assertEqual(forwarded_name, "external.safetensors")
        self.assertEqual(request_json.call_args.kwargs["path"], "/v1/admin/loras/inspect")

    def test_lora_import_forwards_confirmed_metadata_to_image_pool(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            uploads_root = Path(tmpdir) / "uploads"
            upload_id = "a" * 32
            upload_dir = uploads_root / upload_id
            upload_dir.mkdir(parents=True)
            upload_path = upload_dir / "external.safetensors"
            upload_path.write_bytes(b"safe")

            with mock.patch.object(image_pool_loras, "LORA_IMPORT_UPLOADS_ROOT", uploads_root):
                with mock.patch.object(
                    image_pool_loras,
                    "_request_image_pool_json",
                    return_value={"lora": {"id": "imported/external", "path": "/tmp/external.safetensors"}},
                ) as request_json:
                    response = client.post(
                        "/api/image-pool/loras/import",
                        json={
                            "upload_id": upload_id,
                            "name": "External",
                            "family": "flux2-klein",
                            "compatible_models": ["flux2-klein-4b"],
                            "trained_on_model_id": "flux2-klein-4b",
                            "trigger_words": ["EXT"],
                            "default_strength": 0.7,
                            "description": "Imported LoRA.",
                            "source_url": "https://example.test/lora",
                        },
                    )

        self.assertEqual(response.status_code, 200)
        forwarded = request_json.call_args.kwargs["payload"]
        self.assertEqual(forwarded["source_path"], str(upload_path.resolve()))
        self.assertEqual(forwarded["name"], "External")
        self.assertEqual(forwarded["compatible_models"], ["flux2-klein-4b"])
        self.assertEqual(forwarded["trigger_words"], ["EXT"])
        self.assertEqual(forwarded["default_strength"], 0.7)
        self.assertEqual(request_json.call_args.kwargs["path"], "/v1/admin/loras/import")
        self.assertFalse(upload_dir.exists())

    def test_lora_delete_forwards_slug_to_image_pool(self) -> None:
        client = TestClient(app)

        with mock.patch(
            "app.image_pool.loras._request_image_pool_json",
            return_value={"deleted": True, "id": "imported/external"},
        ) as request_json:
            response = client.delete("/api/image-pool/loras/external")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["deleted"], True)
        request_json.assert_called_once_with(
            method="DELETE",
            path="/v1/admin/loras/external",
            timeout=30.0,
        )

    def test_lora_update_forwards_metadata_patch_to_image_pool(self) -> None:
        client = TestClient(app)

        with mock.patch(
            "app.image_pool.loras._request_image_pool_json",
            return_value={"updated": True, "id": "imported/external"},
        ) as request_json:
            response = client.patch(
                "/api/image-pool/loras/external",
                json={
                    "name": "External",
                    "family": "z-image",
                    "compatible_models": ["z-image-turbo"],
                    "trained_on_model_id": "z-image-turbo",
                    "trigger_words": ["EXT"],
                    "default_strength": 1.75,
                    "description": "Updated.",
                    "source_url": "https://example.test/lora",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["updated"], True)
        request_json.assert_called_once_with(
            method="PATCH",
            path="/v1/admin/loras/external",
            payload={
                "name": "External",
                "family": "z-image",
                "compatible_models": ["z-image-turbo"],
                "trained_on_model_id": "z-image-turbo",
                "trigger_words": ["EXT"],
                "default_strength": 1.75,
                "description": "Updated.",
                "source_url": "https://example.test/lora",
            },
            timeout=30.0,
        )

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
