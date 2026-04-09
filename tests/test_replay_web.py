from __future__ import annotations

import io
import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from urllib import error
from pathlib import Path

HAS_FASTAPI = importlib.util.find_spec("fastapi") is not None

if HAS_FASTAPI:
    import app.replay_web as replay_web
    from app.replay_web import create_replay_app
    from fastapi.testclient import TestClient


@unittest.skipUnless(HAS_FASTAPI, "fastapi not installed")
class ReplayWebTests(unittest.TestCase):
    def test_load_service_models_fetches_enabled_models_from_pool(self) -> None:
        class _FakeResponse(io.StringIO):
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_val, exc_tb):
                return False

        payload = '{"default_model":"qwen3-14b-ct2-awq","models":["eurollm-9b-ct2-int8","qwen3-14b-ct2-awq"]}'
        with patch("app.replay_web.request.urlopen", return_value=_FakeResponse(payload)):
            models = replay_web._load_service_models()

        self.assertEqual(models, ["qwen3-14b-ct2-awq", "eurollm-9b-ct2-int8"])

    def test_load_service_models_returns_empty_when_pool_unavailable(self) -> None:
        with patch("app.replay_web.request.urlopen", side_effect=error.URLError("down")):
            models = replay_web._load_service_models()

        self.assertEqual(models, [])

    def test_replay_web_renders_trace_page_for_requested_event(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "replay.pc"
            path.write_text("p,Hel\nc,Hello.\np,How are\nc, How are you?\n", encoding="utf-8")
            app = create_replay_app(
                path=path,
                translator_name="dummy",
                dummy_mode="echo",
            )

            client = TestClient(app)
            response = client.get("/?event=4")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Replay Viewer", response.text)
        self.assertIn("Sample file:", response.text)
        self.assertIn("LLM dir:", response.text)
        self.assertIn(">Source<", response.text)
        self.assertIn(">Target<", response.text)
        self.assertIn("Export text file", response.text)
        self.assertIn("Export final server file", response.text)
        self.assertIn("downloadReplaySnapshot", response.text)
        self.assertIn("current-source-text", response.text)
        self.assertIn("current-target-text", response.text)
        self.assertIn("Hello. How are you?", response.text)
        self.assertIn("preview-fragment", response.text)
        self.assertIn("Target Preview Raw", response.text)
        self.assertIn("Debug Details", response.text)
        self.assertIn("window.history.scrollRestoration", response.text)

    def test_replay_web_renders_autoplay_controls_and_script(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "replay.pc"
            path.write_text("p,Hel\nc,Hello.\np,How are\nc, How are you?\n", encoding="utf-8")
            app = create_replay_app(
                path=path,
                translator_name="dummy",
                dummy_mode="echo",
            )

            client = TestClient(app)
            response = client.get("/?event=2&autoplay=1&speed=fast")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Play", response.text)
        self.assertIn("Pause", response.text)
        self.assertIn("Restart", response.text)
        self.assertIn("Step", response.text)
        self.assertIn("Replay is <strong>running</strong>", response.text)
        self.assertIn("window.setTimeout", response.text)
        self.assertIn("speed=fast", response.text)
        self.assertIn("window.history.scrollRestoration", response.text)

    def test_replay_web_exports_final_text_server_side(self) -> None:
        existing_paths = set(Path("tmp").glob("replay_*_final.txt"))
        existing_summary_paths = set(Path("tmp").glob("replay_*_metrics_summary.json"))
        existing_trace_paths = set(Path("tmp").glob("replay_*_trace.jsonl"))
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "replay.pc"
            path.write_text("p,Hel\nc,Hello.\np,How are\nc, How are you?\n", encoding="utf-8")
            app = create_replay_app(
                path=path,
                translator_name="dummy",
                dummy_mode="echo",
            )

            client = TestClient(app)
            response = client.get("/export/final.txt")
            created_paths = set(Path("tmp").glob("replay_*_final.txt")) - existing_paths
            created_summary_paths = set(Path("tmp").glob("replay_*_metrics_summary.json")) - existing_summary_paths
            created_trace_paths = set(Path("tmp").glob("replay_*_trace.jsonl")) - existing_trace_paths
            self.assertEqual(len(created_paths), 1)
            self.assertEqual(len(created_summary_paths), 1)
            self.assertEqual(len(created_trace_paths), 1)
            export_path = created_paths.pop()
            export_text = export_path.read_text(encoding="utf-8")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Metrics\n", response.text)
        self.assertIn("Source\nHello. How are you?", response.text)
        self.assertIn("Target\nHello. How are you?", response.text)
        self.assertRegex(export_path.name, r"^replay_\d{8}T\d{6}Z_final\.txt$")
        self.assertEqual(response.text, export_text)


if __name__ == "__main__":
    unittest.main()
