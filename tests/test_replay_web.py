from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

HAS_FASTAPI = importlib.util.find_spec("fastapi") is not None

if HAS_FASTAPI:
    from app.replay_web import create_replay_app
    from fastapi.testclient import TestClient


@unittest.skipUnless(HAS_FASTAPI, "fastapi not installed")
class ReplayWebTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
