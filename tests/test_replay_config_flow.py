from __future__ import annotations

import asyncio
import importlib
import sys
from types import SimpleNamespace
import types
import unittest
from unittest.mock import Mock

from app.realtime_translation.replay.metrics import _build_metrics_summary


class ReplayConfigFlowTests(unittest.TestCase):
    def test_metrics_summary_uses_session_settings_default_model(self) -> None:
        session = SimpleNamespace(
            settings=SimpleNamespace(
                first_pass=SimpleNamespace(default_model="session-default-model"),
            ),
            model=None,
            second_pass_model="",
            models_used=set(),
            second_pass_models_used=set(),
            file_path="sample.pc",
            events=[],
        )

        metrics_summary = _build_metrics_summary(session=session, traces=[])

        self.assertEqual(metrics_summary["model"], "session-default-model")

    def test_export_runtime_uses_session_settings_default_model(self) -> None:
        module_name = "app.realtime_translation.replay.export_runtime"
        llm_pool_module_name = "app.llm_pool.models"
        previous_export_module = sys.modules.pop(module_name, None)
        previous_llm_pool_module = sys.modules.get(llm_pool_module_name)

        llm_pool_module = types.ModuleType(llm_pool_module_name)
        llm_pool_module._request_json = Mock(
            return_value={
                "models": [
                    {
                        "name": "session-default-model",
                        "resolved_backend": "gguf",
                        "definition": {
                            "gguf_n_ctx": 8192,
                            "gguf_flash_attn": "auto",
                            "gguf_type_k": None,
                            "gguf_type_v": None,
                        },
                        "load_override": {},
                        "load_constraints": {},
                    }
                ]
            }
        )
        sys.modules[llm_pool_module_name] = llm_pool_module

        try:
            export_runtime = importlib.import_module(module_name)
            session = SimpleNamespace(
                settings=SimpleNamespace(
                    first_pass=SimpleNamespace(default_model="session-default-model"),
                ),
                model=None,
                models_used=set(),
                second_pass_models_used=set(),
                second_pass_model="",
            )

            lines = asyncio.run(export_runtime._build_export_runtime_settings_lines(session))

            self.assertIn("Model backend: gguf", lines)
            self.assertIn("Model context size: 8192", lines)
            llm_pool_module._request_json.assert_called_once_with(
                method="GET",
                path="/v1/admin/models",
                timeout=3.0,
            )
        finally:
            sys.modules.pop(module_name, None)
            if previous_export_module is not None:
                sys.modules[module_name] = previous_export_module
            if previous_llm_pool_module is not None:
                sys.modules[llm_pool_module_name] = previous_llm_pool_module
            else:
                sys.modules.pop(llm_pool_module_name, None)


if __name__ == "__main__":
    unittest.main()
