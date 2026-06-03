from __future__ import annotations

import os
import tempfile
from pathlib import Path
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.image_pool import models as image_pool_models
from app.main import app


class ImagePoolApiTests(unittest.TestCase):
    def test_base_url_uses_local_settings_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            settings_path.write_text(
                '{\n'
                '  "image_pool": {"base_url": "http://settings:8030"}\n'
                '}\n',
                encoding="utf-8",
            )
            settings_path.with_name("local.json").write_text(
                '{\n'
                '  "image_pool": {"base_url": "http://local:8030"}\n'
                '}\n',
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {}, clear=True):
                with mock.patch.object(image_pool_models, "DEFAULT_SETTINGS_PATH", settings_path):
                    self.assertEqual(image_pool_models._image_pool_base_url(), "http://local:8030")

    def test_base_url_env_override_wins_over_settings(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            settings_path = Path(tmpdir) / "settings.json"
            settings_path.write_text(
                '{\n'
                '  "image_pool": {"base_url": "http://settings:8030"}\n'
                '}\n',
                encoding="utf-8",
            )

            with mock.patch.dict(os.environ, {"IMAGE_POOL_API_BASE_URL": "http://env:8030"}, clear=True):
                with mock.patch.object(image_pool_models, "DEFAULT_SETTINGS_PATH", settings_path):
                    self.assertEqual(image_pool_models._image_pool_base_url(), "http://env:8030")

    def test_models_endpoint_uses_public_model_ids(self) -> None:
        client = TestClient(app)

        with mock.patch(
            "app.image_pool.models._request_json",
            return_value={"models": ["stub-image", "qwen-image-edit"]},
        ) as request_json:
            response = client.get("/api/image-pool/models")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            [
                {"id": "stub-image", "name": "stub-image"},
                {"id": "qwen-image-edit", "name": "qwen-image-edit"},
            ],
        )
        request_json.assert_called_once_with(method="GET", path="/v1/models", timeout=2.0)

    def test_admin_models_endpoint_preserves_image_pool_fields(self) -> None:
        client = TestClient(app)

        admin_payload = {
            "models": [
                {
                    "name": "stub-image",
                    "resolved_backend": "stub",
                    "configured_enabled": True,
                    "runtime_state": "loaded",
                    "is_loaded": True,
                    "inflight_requests": 1,
                    "queue_depth": 2,
                    "configured_target_inflight": 1,
                    "effective_target_inflight": 1,
                    "last_error": None,
                    "vram_estimate_mib": None,
                    "vram_estimate_source": "unavailable",
                    "capabilities": {
                        "tasks": ["translate_text", "edit_image"],
                        "input_mime_types": ["image/png"],
                        "output_mime_types": ["image/png"],
                    },
                    "definition": {
                        "model_path": "",
                        "backend": "stub",
                        "enabled": True,
                        "target_inflight": 1,
                    },
                }
            ]
        }

        with mock.patch("app.image_pool.models._request_json", return_value=admin_payload) as request_json:
            response = client.get("/api/image-pool/models/admin")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["models"][0]["name"], "stub-image")
        self.assertEqual(payload["models"][0]["queue_depth"], 2)
        self.assertEqual(payload["models"][0]["configured_target_inflight"], 1)
        self.assertEqual(payload["models"][0]["capabilities"]["tasks"], ["translate_text", "edit_image"])
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
                "name": "stub-image",
                "resolved_backend": "stub",
                "configured_enabled": True,
                "runtime_state": "loaded",
                "is_loaded": True,
                "inflight_requests": 0,
                "queue_depth": 0,
                "configured_target_inflight": 2,
                "effective_target_inflight": 1,
                "last_error": None,
                "vram_estimate_mib": None,
                "vram_estimate_source": "unavailable",
                "capabilities": {"tasks": ["edit_image"]},
                "definition": {"backend": "stub", "target_inflight": 1},
            }

        with mock.patch("app.image_pool.models._request_json", side_effect=fake_request_json):
            response = client.post("/api/image-pool/models/admin/stub-image/load", json={"target_inflight": 2})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["path"], "/v1/admin/models/stub-image/load")
        self.assertEqual(captured["timeout"], 30.0)
        self.assertEqual(captured["payload"], {"target_inflight": 2})
        self.assertEqual(response.json()["configured_target_inflight"], 2)

    def test_submit_request_forwards_multipart_payload(self) -> None:
        client = TestClient(app)
        captured: dict[str, object] = {}

        def fake_submit(**kwargs: object) -> dict:
            captured.update(kwargs)
            return {
                "request_id": "imgreq_test",
                "state": "queued",
                "task": "translate_text",
                "model": "stub-image",
                "priority": "normal",
                "consumer_id": "unknown",
                "fairness_key": "",
                "queue_position": 1,
                "submitted_at_utc": "2026-06-03T00:00:00Z",
                "stage": "queued",
                "timings": {},
            }

        with mock.patch("app.image_pool.requests._request_multipart_json", side_effect=fake_submit):
            response = client.post(
                "/api/image-pool/requests",
                files={
                    "request_json": (None, '{"task":"translate_text","model":"stub-image"}', "application/json"),
                    "image_file": ("input.png", b"png-bytes", "image/png"),
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["request_id"], "imgreq_test")
        self.assertEqual(captured["path"], "/v1/image/requests")
        self.assertEqual(captured["request_json"], '{"task":"translate_text","model":"stub-image"}')
        self.assertEqual(captured["image_filename"], "input.png")
        self.assertEqual(captured["image_content_type"], "image/png")
        self.assertEqual(captured["image_bytes"], b"png-bytes")

    def test_request_status_cancel_and_pool_forward_to_image_pool(self) -> None:
        client = TestClient(app)
        calls: list[dict[str, object]] = []

        def fake_request_json(*, method: str, path: str, payload: dict | None = None, timeout: float = 0.0) -> dict:
            calls.append({"method": method, "path": path, "payload": payload, "timeout": timeout})
            return {"ok": True, "path": path}

        with mock.patch("app.image_pool.requests._request_json", side_effect=fake_request_json):
            status_response = client.get("/api/image-pool/requests/req 1")
            cancel_response = client.post("/api/image-pool/requests/req 1/cancel")
            pool_response = client.get("/api/image-pool/pool")

        self.assertEqual(status_response.status_code, 200)
        self.assertEqual(cancel_response.status_code, 200)
        self.assertEqual(pool_response.status_code, 200)
        self.assertEqual(calls[0]["method"], "GET")
        self.assertEqual(calls[0]["path"], "/v1/image/requests/req%201")
        self.assertEqual(calls[1]["method"], "POST")
        self.assertEqual(calls[1]["path"], "/v1/image/requests/req%201/cancel")
        self.assertEqual(calls[2]["method"], "GET")
        self.assertEqual(calls[2]["path"], "/v1/image/pool")

    def test_artifact_endpoint_proxies_binary_response(self) -> None:
        client = TestClient(app)

        with mock.patch("app.image_pool.requests._request_binary", return_value=(b"png-bytes", "image/png")) as request_binary:
            response = client.get("/api/image-pool/requests/req-1/artifacts/output")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertEqual(response.content, b"png-bytes")
        request_binary.assert_called_once_with(
            path="/v1/image/requests/req-1/artifacts/output",
            timeout=10.0,
        )


if __name__ == "__main__":
    unittest.main()
