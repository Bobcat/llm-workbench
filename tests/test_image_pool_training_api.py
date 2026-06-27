from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from app.image_pool import training
from app.main import app


class _FakeImageResponse:
    def __enter__(self) -> "_FakeImageResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return b"image-bytes"


class ImagePoolTrainingApiTests(unittest.TestCase):
    def test_training_datasets_list_is_empty_before_datasets_are_created(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", Path(tmpdir)):
                response = client.get("/api/image-pool/training/datasets")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["default_slug"], "")
        self.assertEqual(payload["datasets"], [])

    def test_training_datasets_list_hides_incomplete_sample_dataset(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            sample_root = root / "bfl-graphic-impressions"
            sample_root.mkdir()
            (sample_root / "GFX_IMP (1).png").write_bytes(b"image-bytes")

            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                response = client.get("/api/image-pool/training/datasets")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["default_slug"], "")
        self.assertEqual(payload["datasets"], [])

    def test_create_dataset_and_upload_files(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                create_response = client.post(
                    "/api/image-pool/training/datasets",
                    json={"name": "Local Scorpions", "trigger_word": "SCORP"},
                )
                slug = create_response.json()["dataset"]["slug"]
                upload_response = client.post(
                    f"/api/image-pool/training/datasets/{slug}/files",
                    files=[
                        ("files", ("local.png", b"image-bytes", "image/png")),
                        ("files", ("local.txt", b"SCORP. Caption.\n", "text/plain")),
                    ],
                )
                image_response = client.get(f"/api/image-pool/training/datasets/{slug}/images/local.png")

        self.assertEqual(create_response.status_code, 200)
        self.assertEqual(slug, "local-scorpions")
        self.assertEqual(upload_response.status_code, 200)
        payload = upload_response.json()
        self.assertEqual(payload["image_count"], 1)
        self.assertEqual(payload["downloaded_count"], 1)
        self.assertEqual(payload["captioned_count"], 1)
        self.assertEqual(payload["imported"], 2)
        self.assertEqual(payload["images"][0]["filename"], "local.png")
        self.assertEqual(payload["images"][0]["caption"], "SCORP. Caption.")
        self.assertEqual(image_response.status_code, 200)
        self.assertEqual(image_response.content, b"image-bytes")

    def test_delete_custom_dataset_removes_dataset_directory(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            dataset_root = root / "custom-set"
            dataset_root.mkdir()
            (dataset_root / "example.png").write_bytes(b"image-bytes")

            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                with mock.patch.object(training, "_image_pool_training_models", return_value=[]):
                    response = client.delete("/api/image-pool/training/datasets/custom-set")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["deleted_slug"], "custom-set")
            self.assertFalse(dataset_root.exists())
            self.assertEqual(payload["datasets"], [])

    def test_delete_sample_dataset_removes_local_files_and_dataset_entry(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            sample_root = root / "bfl-graphic-impressions"
            sample_root.mkdir()
            (sample_root / "GFX_IMP (1).png").write_bytes(b"image-bytes")
            (sample_root / "GFX_IMP (1).txt").write_text("GFX_IMPR5N. Caption.\n", encoding="utf-8")

            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                with mock.patch.object(training, "_image_pool_training_models", return_value=[]):
                    response = client.delete("/api/image-pool/training/datasets/bfl-graphic-impressions")

            payload = response.json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["deleted_slug"], "bfl-graphic-impressions")
        self.assertEqual(payload["default_slug"], "")
        self.assertEqual(payload["datasets"], [])
        self.assertFalse((sample_root / "GFX_IMP (1).png").exists())
        self.assertFalse((sample_root / "GFX_IMP (1).txt").exists())

    def test_delete_missing_sample_dataset_returns_not_found(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                with mock.patch.object(training, "_image_pool_training_models", return_value=[]):
                    response = client.delete("/api/image-pool/training/datasets/bfl-graphic-impressions")

        self.assertEqual(response.status_code, 404)

    def test_download_sample_dataset_writes_images(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                with mock.patch.object(training, "_image_pool_training_models", return_value=[]):
                    with mock.patch("app.image_pool.training.request.urlopen", return_value=_FakeImageResponse()) as urlopen:
                        response = client.post(
                            "/api/image-pool/training/datasets/bfl-graphic-impressions/sample-download"
                        )

            sample_root = root / "bfl-graphic-impressions"
            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["downloaded_now"], 27)
            self.assertEqual(payload["downloaded_count"], 27)
            self.assertEqual(urlopen.call_count, 27)
            self.assertTrue((sample_root / "GFX_IMP (1).png").exists())
            self.assertEqual((sample_root / "GFX_IMP (1).png").read_bytes(), b"image-bytes")

    def test_caption_training_image_uses_llm_pool_and_writes_caption(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            dataset_root = root / "custom-set"
            dataset_root.mkdir(parents=True)
            image_path = dataset_root / "example.png"
            image_path.write_bytes(b"image-bytes")

            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                with mock.patch(
                    "app.image_pool.training._run_prompt_runner_payload",
                    return_value=({"output_text": "Waist up view of a centered person.", "id": "req-1"}, 12.5),
                ) as runner:
                    response = client.post(
                        "/api/image-pool/training/datasets/custom-set/caption",
                        json={"model": "vlm-model", "image_id": "01", "trigger_word": "GFX_IMPR5N"},
                    )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["caption"], "GFX_IMPR5N. Waist up view of a centered person.")
            self.assertTrue(payload["image"]["captioned"])
            self.assertEqual((dataset_root / "example.txt").read_text(encoding="utf-8").strip(), payload["caption"])

            runner.assert_called_once()
            llm_payload = runner.call_args.args[0]
            self.assertEqual(llm_payload["model"], "vlm-model")
            self.assertIn("Begin exactly: GFX_IMPR5N.", llm_payload["input"][0]["text"])
            self.assertIn("A caption containing an invalid word fails the task", llm_payload["instructions"])
            self.assertEqual(llm_payload["input"][1]["image_url"]["url"], "data:image/png;base64,aW1hZ2UtYnl0ZXM=")

    def test_caption_training_image_forwards_custom_prompts(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            dataset_root = root / "custom-set"
            dataset_root.mkdir(parents=True)
            (dataset_root / "example.png").write_bytes(b"image-bytes")

            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                with mock.patch(
                    "app.image_pool.training._run_prompt_runner_payload",
                    return_value=({"output_text": "CUSTOM. A short caption.", "id": "req-2"}, 8.0),
                ) as runner:
                    response = client.post(
                        "/api/image-pool/training/datasets/custom-set/caption",
                        json={
                            "model": "vlm-model",
                            "image_id": "01",
                            "trigger_word": "CUSTOM",
                            "caption_prompt": "Custom user prompt.",
                            "system_prompt": "Custom system prompt.",
                        },
                    )

        self.assertEqual(response.status_code, 200)
        llm_payload = runner.call_args.args[0]
        self.assertEqual(llm_payload["input"][0]["text"], "Custom user prompt.")
        self.assertEqual(llm_payload["instructions"], "Custom system prompt.")

    def test_training_run_status_reports_dataset_and_image_pool_trainer(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "custom-set").mkdir()
            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                with mock.patch(
                    "app.image_pool.training._request_image_pool_json",
                    return_value={
                        "backend": {
                            "id": "diffusers_flux2_lora",
                            "implemented": False,
                            "available": False,
                            "message": "Flux LoRA trainer is not implemented in image-pool yet.",
                        },
                        "run": {"status": "idle", "message": ""},
                    },
                ):
                    response = client.get("/api/image-pool/training/datasets/custom-set/run")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["dataset"]["ready"])
        self.assertFalse(payload["trainer"]["available"])
        self.assertEqual(payload["trainer"]["id"], "diffusers_flux2_lora")
        self.assertEqual(payload["run"]["status"], "idle")
        self.assertEqual(payload["request"]["model"], "flux2-klein-base-4b")

    def test_training_run_requires_complete_dataset(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            dataset_root = root / "custom-set"
            dataset_root.mkdir()
            (dataset_root / "example.png").write_bytes(b"image-bytes")
            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                response = client.post(
                    "/api/image-pool/training/datasets/custom-set/run",
                    json={"trigger_word": "GFX_IMPR5N"},
                )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["error"], "training_dataset_not_ready")

    def test_training_run_forwards_selected_dataset_to_image_pool(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir) / "datasets"
            runs_root = Path(tmpdir) / "runs"
            dataset_root = root / "custom-set"
            dataset_root.mkdir(parents=True)
            (dataset_root / "example.png").write_bytes(b"image-bytes")
            (dataset_root / "example.txt").write_text("GFX_IMPR5N. Caption.\n", encoding="utf-8")

            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                with mock.patch.object(training, "TRAINING_RUNS_ROOT", runs_root):
                    with mock.patch(
                        "app.image_pool.training._request_image_pool_json",
                        return_value={
                            "backend": {"id": "diffusers_flux2_lora", "available": True},
                            "run": {"status": "running", "message": "training"},
                        },
                    ) as image_pool_request:
                        response = client.post(
                            "/api/image-pool/training/datasets/custom-set/run",
                            json={"trigger_word": "GFX_IMPR5N", "steps": 20, "checkpoint_interval": 10},
                        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["run"]["status"], "running")
        start_call = next(
            call for call in image_pool_request.call_args_list
            if call.kwargs["method"] == "POST" and call.kwargs["path"] == "/v1/training/flux-lora"
        )
        self.assertEqual(start_call.kwargs["method"], "POST")
        self.assertEqual(start_call.kwargs["path"], "/v1/training/flux-lora")
        forwarded = start_call.kwargs["payload"]
        self.assertEqual(forwarded["model"], "flux2-klein-base-4b")
        self.assertEqual(forwarded["dataset_path"], str(dataset_root.resolve()))
        self.assertEqual(forwarded["output_path"], str(runs_root.resolve()))
        self.assertEqual(forwarded["trigger_word"], "GFX_IMPR5N")
        self.assertEqual(forwarded["steps"], 20)
        self.assertEqual(forwarded["checkpoint_interval"], 10)
        self.assertEqual(forwarded["metadata"]["dataset"], "custom-set")

    def test_training_run_forwards_z_image_model_to_z_image_trainer(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir) / "datasets"
            flux_runs_root = Path(tmpdir) / "flux-runs"
            z_runs_root = Path(tmpdir) / "z-runs"
            dataset_root = root / "custom-set"
            dataset_root.mkdir(parents=True)
            (dataset_root / "example.png").write_bytes(b"image-bytes")
            (dataset_root / "example.txt").write_text("GFX_IMPR5N. Caption.\n", encoding="utf-8")

            admin_models_payload = {
                "data": [
                    {
                        "id": "z-image-base",
                        "backend": "diffusers_z_image",
                        "model_path": str(Path(tmpdir) / "z-image-base"),
                        "loaded": False,
                    }
                ]
            }
            Path(admin_models_payload["data"][0]["model_path"]).mkdir()

            def fake_image_pool_request(*, method: str, path: str, payload: dict | None = None, timeout: float):
                if path == "/v1/admin/models":
                    return admin_models_payload
                if path == "/v1/training/z-image-lora":
                    return {
                        "backend": {"id": "diffusers_z_image_lora", "available": True},
                        "run": {"status": "running", "message": "training"},
                    }
                if path == "/v1/training/z-image-lora" and method == "GET":
                    return {
                        "backend": {"id": "diffusers_z_image_lora", "available": True},
                        "run": {"status": "running", "message": "training"},
                    }
                return {
                    "backend": {"id": "diffusers_z_image_lora", "available": True},
                    "run": {"status": "running", "message": "training"},
                }

            with mock.patch.object(training, "TRAINING_DATASETS_ROOT", root):
                with mock.patch.object(training, "TRAINING_RUNS_ROOT", flux_runs_root):
                    with mock.patch.object(training, "Z_IMAGE_TRAINING_RUNS_ROOT", z_runs_root):
                        with mock.patch(
                            "app.image_pool.training._request_image_pool_json",
                            side_effect=fake_image_pool_request,
                        ) as image_pool_request:
                            response = client.post(
                                "/api/image-pool/training/datasets/custom-set/run",
                                json={
                                    "trainer": "z-image",
                                    "model": "z-image-base",
                                    "trigger_word": "GFX_IMPR5N",
                                    "steps": 12,
                                    "checkpoint_interval": 6,
                                },
                            )

        self.assertEqual(response.status_code, 200)
        start_call = next(
            call for call in image_pool_request.call_args_list
            if call.kwargs["method"] == "POST" and call.kwargs["path"] == "/v1/training/z-image-lora"
        )
        forwarded = start_call.kwargs["payload"]
        self.assertEqual(forwarded["model"], "z-image-base")
        self.assertEqual(forwarded["output_path"], str(z_runs_root.resolve()))
        self.assertEqual(forwarded["steps"], 12)
        self.assertEqual(forwarded["checkpoint_interval"], 6)
        self.assertEqual(forwarded["rank"], 4)
        self.assertEqual(forwarded["alpha"], 4)
        self.assertEqual(forwarded["resolution"], 1024)
        self.assertEqual(forwarded["metadata"]["trainer"], "z-image")


if __name__ == "__main__":
    unittest.main()
