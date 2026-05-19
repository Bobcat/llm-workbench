from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app


class RealtimeTtsReplayApiTests(unittest.TestCase):
    def test_create_session_keeps_only_committed_segments(self) -> None:
        client = TestClient(app)
        with tempfile.TemporaryDirectory() as tmpdir:
            pc_path = Path(tmpdir) / "sample.pc"
            pc_path.write_text(
                "kind,speech_start_ms,speech_end_ms,text\n"
                'p,0,1000,"preview text"\n'
                'c,0,1200,"first committed"\n'
                'p,1200,1800,"preview only"\n'
                'c,1200,2200,"second committed"\n',
                encoding="utf-8",
            )

            response = client.post(
                "/api/realtime-tts/replay/session",
                json={
                    "file_path": str(pc_path),
                    "model": "stub-tts",
                    "language": "English",
                    "voice_instructions": "Use a clear voice.",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["segment_count"], 2)
        self.assertEqual(payload["model"], "stub-tts")
        self.assertEqual(payload["language"], "English")
        self.assertEqual(payload["voice_instructions"], "Use a clear voice.")

    def test_options_can_be_changed_while_idle(self) -> None:
        client = TestClient(app)
        with tempfile.TemporaryDirectory() as tmpdir:
            pc_path = Path(tmpdir) / "sample.pc"
            pc_path.write_text(
                "kind,speech_start_ms,speech_end_ms,text\n"
                'c,0,1200,"first committed"\n',
                encoding="utf-8",
            )
            create_response = client.post(
                "/api/realtime-tts/replay/session",
                json={"file_path": str(pc_path), "model": "stub-tts"},
            )

        session_id = create_response.json()["session_id"]
        response = client.post(
            f"/api/realtime-tts/replay/{session_id}/options",
            json={
                "model": "kokoro",
                "language": "Dutch",
                "voice_instructions": "Spreek rustig.",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["model"], "kokoro")
        self.assertEqual(payload["language"], "Dutch")
        self.assertEqual(payload["voice_instructions"], "Spreek rustig.")

    def test_start_requires_model(self) -> None:
        client = TestClient(app)
        with tempfile.TemporaryDirectory() as tmpdir:
            pc_path = Path(tmpdir) / "sample.pc"
            pc_path.write_text(
                "kind,speech_start_ms,speech_end_ms,text\n"
                'c,0,1200,"first committed"\n',
                encoding="utf-8",
            )
            create_response = client.post(
                "/api/realtime-tts/replay/session",
                json={"file_path": str(pc_path)},
            )

        session_id = create_response.json()["session_id"]
        response = client.post(f"/api/realtime-tts/replay/{session_id}/start")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "TTS model is required")


if __name__ == "__main__":
    unittest.main()
