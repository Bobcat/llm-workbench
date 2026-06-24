from __future__ import annotations

import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.main import app


class LlmPoolApiTests(unittest.TestCase):
    def test_models_endpoint_uses_public_model_ids(self) -> None:
        client = TestClient(app)

        with mock.patch(
            "app.llm_pool.models._request_json",
            return_value={"models": ["gemma_translate", "gemma_topics_longctx"]},
        ) as request_json:
            response = client.get("/api/models")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            [
                {"id": "gemma_translate", "name": "gemma_translate"},
                {"id": "gemma_topics_longctx", "name": "gemma_topics_longctx"},
            ],
        )
        request_json.assert_called_once_with(method="GET", path="/v1/models", timeout=2.0)

    def test_admin_models_endpoint_preserves_aggregate_replica_fields(self) -> None:
        client = TestClient(app)

        admin_payload = {
            "models": [
                {
                    "name": "gemma_translate",
                    "resolved_backend": "llama_cpp",
                    "configured_enabled": True,
                    "runtime_state": "loaded",
                    "is_loaded": True,
                    "replicas": 2,
                    "replica_max": 3,
                    "loaded_replicas": 2,
                    "inflight_requests": 0,
                    "queue_depth": 0,
                    "runtime_inflight": 0,
                    "configured_target_inflight": 1,
                    "effective_target_inflight": 1,
                    "last_error": None,
                    "vram_estimate_mib": 4096,
                    "vram_estimate_source": "observed_load_delta",
                    "load_constraints": {},
                    "load_recommendations": {},
                    "load_override": {},
                    "definition": {
                        "model_path": "/models/gemma_translate.gguf",
                        "backend": "llama_cpp",
                        "prompt_format": "generic",
                        "enable_thinking": None,
                        "enabled": True,
                        "replicas": 1,
                        "replica_max": 3,
                        "target_inflight": 1,
                        "gguf_n_ctx": 4096,
                    },
                }
            ]
        }

        with (
            mock.patch("app.llm_pool.models._request_json", return_value=admin_payload) as request_json,
            mock.patch("app.llm_pool.models._llm_pool_base_url", return_value="http://pool:8012"),
        ):
            response = client.get("/api/models/admin")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["models"][0]["name"], "gemma_translate")
        self.assertEqual(payload["models"][0]["replicas"], 2)
        self.assertEqual(payload["models"][0]["replica_max"], 3)
        self.assertEqual(payload["models"][0]["loaded_replicas"], 2)
        self.assertEqual(payload["models"][0]["definition"]["replica_max"], 3)
        self.assertEqual(payload["proxy_base_url"], "http://pool:8012")
        request_json.assert_called_once_with(method="GET", path="/v1/admin/models", timeout=3.0)

    def test_load_admin_model_forwards_replica_count(self) -> None:
        client = TestClient(app)
        captured: dict[str, object] = {}

        def fake_request_json(*, method: str, path: str, payload: dict | None = None, timeout: float = 0.0) -> dict:
            captured["method"] = method
            captured["path"] = path
            captured["payload"] = payload
            captured["timeout"] = timeout
            return {
                "name": "gemma_translate",
                "resolved_backend": "llama_cpp",
                "configured_enabled": True,
                "runtime_state": "loaded",
                "is_loaded": True,
                "replicas": 2,
                "replica_max": 3,
                "loaded_replicas": 2,
                "inflight_requests": 0,
                "queue_depth": 0,
                "runtime_inflight": 0,
                "configured_target_inflight": 1,
                "effective_target_inflight": 1,
                "last_error": None,
                "vram_estimate_mib": 4096,
                "vram_estimate_source": "observed_load_delta",
                "load_constraints": {},
                "load_recommendations": {},
                "load_override": {},
                "definition": {
                    "model_path": "/models/gemma_translate.gguf",
                    "backend": "llama_cpp",
                    "prompt_format": "generic",
                    "enable_thinking": None,
                    "enabled": True,
                    "replicas": 1,
                    "replica_max": 3,
                    "target_inflight": 1,
                    "gguf_n_ctx": 4096,
                },
            }

        with mock.patch("app.llm_pool.models._request_json", side_effect=fake_request_json):
            response = client.post("/api/models/admin/gemma_translate/load", json={"replicas": 2})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["path"], "/v1/admin/models/gemma_translate/load")
        self.assertEqual(captured["timeout"], 30.0)
        self.assertEqual(captured["payload"], {"replicas": 2})
        self.assertEqual(response.json()["replicas"], 2)
        self.assertEqual(response.json()["loaded_replicas"], 2)


if __name__ == "__main__":
    unittest.main()
