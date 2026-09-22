from __future__ import annotations

import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient
from promptlib import PromptRecord

from app.main import app
from app.realtime_translation.replay.prompt_selection import PromptLoadError
from app.realtime_translation.replay.sessions import REPLAY_POLICIES
from app.realtime_translation.replay.sessions import ReplaySession
from app.realtime_translation.replay.sessions import _sessions
from app.realtime_translation.replay.settings import load_replay_settings

REPO_ROOT = Path(__file__).resolve().parents[1]
SAMPLE_FILE = REPO_ROOT / "data" / "realtime_translation" / "sample" / "sample_p_c_120s.pc"
SAMPLE_RELATIVE = "data/realtime_translation/sample/sample_p_c_120s.pc"

# Creating a replay session asks translation-services for these two; they are the service's, not
# this repository's.
REPLAY_PROMPTS = ("translate_realtime_first", "translate_realtime_second")

_PROMPTS_AVAILABLE: bool | None = None


def _replay_prompts_available() -> bool:
    """Whether the translation-services behind the workbench has the prompts a session needs.

    Without them the service answers with an error in a 200 body, and every test here that creates a
    session fails on a missing ``session_id`` — a failure that looks like a workbench bug but is a
    missing fixture in a service this repository does not contain. Probed once, through the same
    route the workbench itself uses, so those tests skip with that reason instead of failing.
    """
    global _PROMPTS_AVAILABLE
    if _PROMPTS_AVAILABLE is None:
        try:
            response = TestClient(app, raise_server_exceptions=False).get(
                "/api/translation/prompts"
            )
            payload = response.json()
        except Exception:  # noqa: BLE001 - an unreachable service is the same situation
            _PROMPTS_AVAILABLE = False
        else:
            ids = {str(prompt.get("id", "")) for prompt in payload.get("prompts", [])}
            _PROMPTS_AVAILABLE = set(REPLAY_PROMPTS) <= ids
    return _PROMPTS_AVAILABLE


needs_replay_prompts = unittest.skipUnless(
    _replay_prompts_available(),
    f"translation-services has no {', '.join(REPLAY_PROMPTS)}; run it with the replay prompt library",
)


class ReplayApiTests(unittest.TestCase):
    @needs_replay_prompts
    def test_create_session_resolves_relative_sample_path_from_repo_root(self) -> None:
        client = TestClient(app)

        response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("session_id", payload)
        self.assertNotIn("error", payload)
        self.assertEqual(
            payload.get("second_pass_prompt_id"),
            "translate_realtime_second",
        )

    def test_list_sample_files_returns_pc_files(self) -> None:
        client = TestClient(app)

        response = client.get("/api/replay/samples")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("samples", payload)
        sample_names = [item["name"] for item in payload["samples"]]
        self.assertIn("sample_p_c_120s.pc", sample_names)
        self.assertIn("sample_c_only_120s.pc", sample_names)

    @needs_replay_prompts
    def test_set_second_pass_prompt_accepts_second_pass_prompt(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]

        response = client.post(
            f"/api/replay/{session_id}/second-pass-prompt",
            json={"prompt_id": "translate_realtime_second"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "ok")
        self.assertEqual(payload.get("prompt_id"), "translate_realtime_second")

    @needs_replay_prompts
    def test_set_second_pass_model_uses_second_pass_backend_terms(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]

        response = client.post(
            f"/api/replay/{session_id}/second-pass-model",
            json={"model": "google_gemma-4-E4B-it-Q5_K_M-gguf"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("status"), "ok")
        self.assertEqual(payload.get("second_pass_model"), "google_gemma-4-E4B-it-Q5_K_M-gguf")
        self.assertTrue(payload.get("second_pass_enabled"))

    @needs_replay_prompts
    def test_replay_websocket_uses_delta_transcript_updates(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]

        speed_response = client.post(
            f"/api/replay/{session_id}/speed",
            json={"speed": "fast7"},
        )
        self.assertEqual(speed_response.status_code, 200)

        with client.websocket_connect(f"/ws/replay/{session_id}") as websocket:
            session_info = websocket.receive_json()
            self.assertEqual(session_info["type"], "session_info")
            self.assertIn("second_pass_model", session_info["data"])
            self.assertIn("second_pass_enabled", session_info["data"])
            self.assertEqual(session_info["data"]["source_duration_ms"], 120022)

            source_update = websocket.receive_json()
            self.assertEqual(source_update["type"], "source_update")
            self.assertTrue(source_update["data"]["reset"])
            self.assertIn("committed_append", source_update["data"])
            self.assertNotIn("committed", source_update["data"])
            self.assertEqual(source_update["data"]["source_timing"]["speech_start_ms"], 0)
            self.assertEqual(source_update["data"]["source_timing"]["speech_end_ms"], 335)
            self.assertEqual(source_update["data"]["source_timing"]["source_duration_ms"], 120022)
            self.assertEqual(source_update["data"]["source_timing"]["clock"], "fixed_delay")

            target_update = websocket.receive_json()
            self.assertEqual(target_update["type"], "target_update")
            self.assertTrue(target_update["data"]["reset"])
            self.assertIn("committed_append", target_update["data"])
            self.assertNotIn("committed", target_update["data"])

            start_response = client.post(f"/api/replay/{session_id}/start")
            self.assertEqual(start_response.status_code, 200)

            playing_source_update = None
            translation_outcome = None
            for _ in range(10):
                message = websocket.receive_json()
                if message["type"] == "source_update" and message["data"].get("status") == "playing":
                    playing_source_update = message
                if message["type"] == "translation_outcome":
                    translation_outcome = message
                if playing_source_update is not None and translation_outcome is not None:
                    break

            self.assertIsNotNone(playing_source_update)
            self.assertIn("committed_append", playing_source_update["data"])
            self.assertNotIn("committed", playing_source_update["data"])
            self.assertIn("source_timing", playing_source_update["data"])
            self.assertIsNotNone(translation_outcome)
            self.assertIn("translated", translation_outcome["data"])
            self.assertIn("request_executed", translation_outcome["data"])
            self.assertIn("event_kind", translation_outcome["data"])

    @needs_replay_prompts
    def test_export_includes_llama_cpp_runtime_settings(self) -> None:
        client = TestClient(app)
        create_response = client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/sample_p_c_120s.pc"},
        )
        self.assertEqual(create_response.status_code, 200)
        session_id = create_response.json()["session_id"]
        session = _sessions[session_id]
        session.model = "google_gemma-4-E2B-it-Q8_0-gguf"
        session.models_used = {"google_gemma-4-E2B-it-Q8_0-gguf"}
        session.source_committed_text = "source text"
        session.target_committed_text = "target text"

        with mock.patch(
            "app.realtime_translation.replay.export_runtime._llm_pool_request_json",
            return_value={
                "models": [
                    {
                        "name": "google_gemma-4-E2B-it-Q8_0-gguf",
                        "resolved_backend": "llama_cpp",
                        "definition": {
                            "gguf_n_ctx": 16384,
                            "gguf_flash_attn": "auto",
                            "gguf_type_k": None,
                            "gguf_type_v": None,
                        },
                        "load_override": {
                            "gguf_flash_attn": "on",
                            "gguf_type_k": "q4_0",
                            "gguf_type_v": "q4_0",
                        },
                        "load_constraints": {
                            "gguf_type_k": {"default": "f16"},
                            "gguf_type_v": {"default": "f16"},
                            "gguf_flash_attn": {"default": "auto"},
                        },
                    }
                ]
            },
        ):
            response = client.get(f"/api/replay/{session_id}/export")

        self.assertEqual(response.status_code, 200)
        content = response.text
        self.assertIn("Model backend: llama_cpp", content)
        self.assertIn("Model context size: 16384", content)
        self.assertIn("Model flash attn: on", content)
        self.assertIn("Model K type: q4_0", content)
        self.assertIn("Model V type: q4_0", content)


class ReplayErrorStatusTests(unittest.TestCase):
    """Failures answer with a real HTTP status instead of ``200`` plus an ``error`` body.

    A session is built here directly from the shipped sample file, so these tests do not need
    translation-services: the state they exercise (unknown session, bad preset, empty language,
    session without events) is local to the workbench.
    """

    def setUp(self) -> None:
        self.client = TestClient(app)
        self._created: list[str] = []

    def tearDown(self) -> None:
        for session_id in self._created:
            _sessions.pop(session_id, None)

    def _session(self, *, events: list[object] | None = None) -> str:
        session_id = f"test-{len(self._created)}-{id(self)}"
        prompt = PromptRecord(id="test_prompt", title="test", prompt_text="", system_prompt="")
        session = ReplaySession.create(
            session_id=session_id,
            file_path=SAMPLE_FILE,
            settings=load_replay_settings(),
            default_first_pass_prompt=prompt,
            default_second_pass_prompt=prompt,
        )
        if events is not None:
            session.events = events
        _sessions[session_id] = session
        self._created.append(session_id)
        return session_id

    def test_unknown_session_answers_404_on_every_session_route(self) -> None:
        routes = [
            ("/speed", {"speed": "fast7"}),
            ("/policy", {"policy": sorted(REPLAY_POLICIES)[0]}),
            ("/model", {"model": "some-model"}),
            ("/second-pass-model", {"model": "some-model"}),
            ("/first-pass-prompt", {"prompt_id": "some-prompt"}),
            ("/second-pass-prompt", {"prompt_id": "some-prompt"}),
            ("/first-pass-languages", {"source_language": "en"}),
            ("/start", None),
            ("/pause", None),
            ("/reset", None),
        ]

        for suffix, body in routes:
            with self.subTest(route=suffix):
                response = self.client.post(f"/api/replay/absent-session{suffix}", json=body)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.json(), {"detail": "Session not found"})

        export_response = self.client.get("/api/replay/absent-session/export")
        self.assertEqual(export_response.status_code, 404)
        self.assertEqual(export_response.json(), {"detail": "Session not found"})

    def test_missing_sample_file_answers_404_with_the_resolved_path(self) -> None:
        response = self.client.post(
            "/api/replay/session",
            json={"file_path": "data/realtime_translation/sample/does_not_exist.pc"},
        )

        self.assertEqual(response.status_code, 404)
        detail = response.json()["detail"]
        self.assertEqual(detail["error"], "File not found")
        self.assertTrue(detail["path"].endswith("sample/does_not_exist.pc"))

    def test_invalid_speed_preset_answers_400(self) -> None:
        session_id = self._session()

        response = self.client.post(
            f"/api/replay/{session_id}/speed",
            json={"speed": "ludicrous"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Invalid speed: ludicrous"})

    def test_invalid_policy_answers_400_and_policy_change_while_playing_answers_409(self) -> None:
        session_id = self._session()
        valid_policy = sorted(REPLAY_POLICIES)[0]

        invalid_response = self.client.post(
            f"/api/replay/{session_id}/policy",
            json={"policy": "not-a-policy"},
        )
        self.assertEqual(invalid_response.status_code, 400)
        self.assertEqual(invalid_response.json(), {"detail": "Invalid policy: not-a-policy"})

        _sessions[session_id].status = "playing"
        busy_response = self.client.post(
            f"/api/replay/{session_id}/policy",
            json={"policy": valid_policy},
        )
        self.assertEqual(busy_response.status_code, 409)
        self.assertEqual(
            busy_response.json(),
            {"detail": "Policy can only be changed while idle. Reset first."},
        )

    def test_empty_language_answers_400(self) -> None:
        session_id = self._session()

        source_response = self.client.post(
            f"/api/replay/{session_id}/first-pass-languages",
            json={"source_language": "   "},
        )
        self.assertEqual(source_response.status_code, 400)
        self.assertEqual(source_response.json(), {"detail": "source_language must not be empty"})

        target_response = self.client.post(
            f"/api/replay/{session_id}/first-pass-languages",
            json={"target_language": ""},
        )
        self.assertEqual(target_response.status_code, 400)
        self.assertEqual(target_response.json(), {"detail": "target_language must not be empty"})

    def test_export_without_events_answers_409(self) -> None:
        session_id = self._session(events=[])

        response = self.client.get(f"/api/replay/{session_id}/export")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {"detail": "No events in session"})

    @mock.patch(
        "app.realtime_translation.replay.prompt_selection._load_prompt",
        side_effect=PromptLoadError("Prompt 'translate_realtime_first' not found.", 404),
    )
    def test_absent_prompt_answers_404(self, _load_prompt: mock.Mock) -> None:
        session_id = self._session()

        response = self.client.post(
            f"/api/replay/{session_id}/first-pass-prompt",
            json={"prompt_id": "translate_realtime_first"},
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Prompt 'translate_realtime_first' not found."})

    @mock.patch(
        "app.realtime_translation.replay.replay._load_first_pass_prompt",
        side_effect=PromptLoadError("translation-services unreachable: refused", 502),
    )
    def test_unreachable_translation_services_answers_502_on_session_create(
        self, _load_first_pass_prompt: mock.Mock
    ) -> None:
        response = self.client.post("/api/replay/session", json={"file_path": SAMPLE_RELATIVE})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.json(),
            {"detail": "translation-services unreachable: refused"},
        )

    @mock.patch(
        "app.realtime_translation.replay.replay._load_first_pass_prompt",
        side_effect=PromptLoadError("Prompt 'translate_realtime_first' not found.", 404),
    )
    def test_missing_default_prompt_answers_502_on_session_create(
        self, _load_first_pass_prompt: mock.Mock
    ) -> None:
        """The default prompt id is the server's choice, so its absence is an upstream failure."""
        response = self.client.post("/api/replay/session", json={"file_path": SAMPLE_RELATIVE})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(
            response.json(),
            {"detail": "Prompt 'translate_realtime_first' not found."},
        )


if __name__ == "__main__":
    unittest.main()
