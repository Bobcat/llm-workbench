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
    def test_training_dataset_lists_bfl_graphic_impressions_images(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch.object(training, "TRAINING_DATA_ROOT", Path(tmpdir)):
                response = client.get("/api/image-pool/training/flux2-klein/bfl-graphic-impressions")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["slug"], "bfl-graphic-impressions")
        self.assertEqual(payload["trigger_word"], "GFX_IMPR5N")
        self.assertEqual(payload["image_count"], 27)
        self.assertEqual(payload["downloaded_count"], 0)
        self.assertEqual(payload["captioned_count"], 0)
        self.assertIn("Begin exactly: GFX_IMPR5N.", payload["caption_prompt"])
        self.assertEqual(
            payload["caption_system_prompt"],
            "You write factual captions for image model training. A caption containing an invalid word fails the task.",
        )
        self.assertEqual(payload["caption_decoding"]["temperature"], 0)
        self.assertEqual(payload["images"][0]["id"], "01")
        self.assertEqual(payload["images"][0]["filename"], "GFX_IMP (1).png")
        self.assertIn("The words dark, black, red", payload["caption_prompt"])

    def test_download_training_dataset_writes_images(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            with mock.patch.object(training, "TRAINING_DATA_ROOT", root):
                with mock.patch.object(training, "_image_pool_training_models", return_value=[]):
                    with mock.patch("app.image_pool.training.request.urlopen", return_value=_FakeImageResponse()) as urlopen:
                        response = client.post("/api/image-pool/training/flux2-klein/bfl-graphic-impressions/download")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["downloaded_now"], 27)
            self.assertEqual(payload["downloaded_count"], 27)
            self.assertEqual(urlopen.call_count, 27)
            self.assertTrue((root / "GFX_IMP (1).png").exists())
            self.assertEqual((root / "GFX_IMP (1).png").read_bytes(), b"image-bytes")

    def test_caption_training_image_uses_llm_pool_and_writes_caption(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            image_path = root / "GFX_IMP (1).png"
            image_path.parent.mkdir(parents=True, exist_ok=True)
            image_path.write_bytes(b"image-bytes")

            with mock.patch.object(training, "TRAINING_DATA_ROOT", root):
                with mock.patch(
                    "app.image_pool.training._run_prompt_runner_payload",
                    return_value=({"output_text": "Waist up view of a centered person.", "id": "req-1"}, 12.5),
                ) as runner:
                    response = client.post(
                        "/api/image-pool/training/flux2-klein/bfl-graphic-impressions/caption",
                        json={"model": "vlm-model", "image_id": "01", "trigger_word": "GFX_IMPR5N"},
                    )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["caption"], "GFX_IMPR5N. Waist up view of a centered person.")
            self.assertTrue(payload["image"]["captioned"])
            self.assertEqual((root / "GFX_IMP (1).txt").read_text(encoding="utf-8").strip(), payload["caption"])

            runner.assert_called_once()
            llm_payload = runner.call_args.args[0]
            self.assertEqual(llm_payload["model"], "vlm-model")
            self.assertIn("Begin exactly: GFX_IMPR5N.", llm_payload["input"][0]["text"])
            self.assertIn("A caption containing an invalid word fails the task", llm_payload["instructions"])
            self.assertIn("Omit style and rendering details", llm_payload["input"][0]["text"])
            self.assertEqual(
                llm_payload["instructions"],
                "You write factual captions for image model training. A caption containing an invalid word fails the task.",
            )
            self.assertEqual(llm_payload["decoding"]["temperature"], 0)
            self.assertEqual(llm_payload["input"][1]["image_url"]["url"], "data:image/png;base64,aW1hZ2UtYnl0ZXM=")

    def test_caption_training_image_forwards_custom_prompts(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            image_path = root / "GFX_IMP (1).png"
            image_path.write_bytes(b"image-bytes")

            with mock.patch.object(training, "TRAINING_DATA_ROOT", root):
                with mock.patch(
                    "app.image_pool.training._run_prompt_runner_payload",
                    return_value=({"output_text": "CUSTOM. A short caption.", "id": "req-2"}, 8.0),
                ) as runner:
                    response = client.post(
                        "/api/image-pool/training/flux2-klein/bfl-graphic-impressions/caption",
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
            with mock.patch.object(training, "TRAINING_DATA_ROOT", Path(tmpdir)):
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
                    response = client.get("/api/image-pool/training/flux2-klein/bfl-graphic-impressions/run")

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
            with mock.patch.object(training, "TRAINING_DATA_ROOT", Path(tmpdir)):
                response = client.post(
                    "/api/image-pool/training/flux2-klein/bfl-graphic-impressions/run",
                    json={"trigger_word": "GFX_IMPR5N"},
                )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"]["error"], "training_dataset_not_ready")

    def test_training_run_forwards_dataset_to_image_pool(self) -> None:
        client = TestClient(app)

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir) / "dataset"
            runs_root = Path(tmpdir) / "runs"
            root.mkdir()
            for entry in training._entries():
                (root / entry["filename"]).write_bytes(b"image-bytes")
                (root / entry["caption_filename"]).write_text("GFX_IMPR5N. Caption.\n", encoding="utf-8")

            with mock.patch.object(training, "TRAINING_DATA_ROOT", root):
                with mock.patch.object(training, "TRAINING_RUNS_ROOT", runs_root):
                    with mock.patch(
                        "app.image_pool.training._request_image_pool_json",
                        return_value={
                            "backend": {"id": "diffusers_flux2_lora", "available": True},
                            "run": {"status": "running", "message": "training"},
                        },
                    ) as image_pool_request:
                        response = client.post(
                            "/api/image-pool/training/flux2-klein/bfl-graphic-impressions/run",
                            json={"trigger_word": "GFX_IMPR5N", "steps": 20},
                        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["run"]["status"], "running")
        start_call = image_pool_request.call_args_list[0]
        self.assertEqual(start_call.kwargs["method"], "POST")
        self.assertEqual(start_call.kwargs["path"], "/v1/training/flux-lora")
        forwarded = start_call.kwargs["payload"]
        self.assertEqual(forwarded["model"], "flux2-klein-base-4b")
        self.assertEqual(forwarded["dataset_path"], str(root.resolve()))
        self.assertEqual(forwarded["output_path"], str(runs_root.resolve()))
        self.assertEqual(forwarded["trigger_word"], "GFX_IMPR5N")
        self.assertEqual(forwarded["steps"], 20)


if __name__ == "__main__":
    unittest.main()
