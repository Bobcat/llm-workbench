from __future__ import annotations

import unittest
from unittest import mock

from fastapi import HTTPException

from app.prompt_testing import chat


_TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
_TINY_PDF_DATA_URL = "data:application/pdf;base64,JVBERi0="


def _turn(role: str, text: str = "", images=None, files=None) -> chat.ChatTurnInput:
    return chat.ChatTurnInput(
        role=role,
        text=text,
        images=[chat.ChatImageInput(data_url=url) for url in (images or [])],
        files=[
            chat.ChatFileInput(name=name, data_url=data_url)
            for name, data_url in (files or [])
        ],
    )


class ChatMultiTurnMessagesTests(unittest.TestCase):
    def test_text_turns_use_string_content(self) -> None:
        messages = chat._multi_turn_messages(
            [_turn("user", "Hi"), _turn("assistant", "Hello!"), _turn("user", "Now?")]
        )
        self.assertEqual(
            [(m["role"], m["content"]) for m in messages],
            [("user", "Hi"), ("assistant", "Hello!"), ("user", "Now?")],
        )

    def test_turn_with_image_uses_content_list_text_then_image(self) -> None:
        messages = chat._multi_turn_messages(
            [_turn("user", "What is this?", images=[_TINY_PNG_DATA_URL])]
        )
        content = messages[0]["content"]
        self.assertIsInstance(content, list)
        self.assertEqual(content[0], {"type": "text", "text": "What is this?"})
        self.assertEqual(content[1]["type"], "image_url")
        self.assertEqual(content[1]["image_url"]["url"], _TINY_PNG_DATA_URL)

    def test_image_turn_without_text_is_image_only(self) -> None:
        messages = chat._multi_turn_messages([_turn("user", "  ", images=[_TINY_PNG_DATA_URL])])
        content = messages[0]["content"]
        self.assertEqual(len(content), 1)
        self.assertEqual(content[0]["type"], "image_url")

    def test_turn_with_native_file_forwards_original_data(self) -> None:
        messages = chat._multi_turn_messages(
            [
                _turn(
                    "user",
                    "Summarize this.",
                    files=[("paper.pdf", _TINY_PDF_DATA_URL)],
                )
            ]
        )
        content = messages[0]["content"]
        self.assertEqual(content[0], {"type": "text", "text": "Summarize this."})
        self.assertEqual(
            content[1],
            {
                "type": "file",
                "file": {
                    "filename": "paper.pdf",
                    "file_data": _TINY_PDF_DATA_URL,
                },
            },
        )


class ChatFlattenTests(unittest.TestCase):
    def test_transcript_is_role_labelled_in_order(self) -> None:
        transcript = chat._flattened_transcript(
            [_turn("user", "Hi"), _turn("assistant", "Hello!"), _turn("user", "Bye")]
        )
        self.assertEqual(transcript, "User: Hi\n\nAssistant: Hello!\n\nUser: Bye")

    def test_flattened_input_is_plain_string_without_images(self) -> None:
        result = chat._flattened_input([_turn("user", "Hi"), _turn("user", "There")])
        self.assertIsInstance(result, str)

    def test_flattened_input_attaches_last_turn_images(self) -> None:
        result = chat._flattened_input(
            [_turn("user", "first"), _turn("user", "look", images=[_TINY_PNG_DATA_URL])]
        )
        self.assertIsInstance(result, list)
        self.assertEqual(result[0]["type"], "text")
        self.assertIn("User: look", result[0]["text"])
        self.assertEqual(result[1]["type"], "image_url")

    def test_flattened_input_attaches_last_turn_files(self) -> None:
        result = chat._flattened_input(
            [
                _turn("user", "first"),
                _turn(
                    "user",
                    "summarize",
                    files=[("paper.pdf", _TINY_PDF_DATA_URL)],
                ),
            ]
        )
        self.assertIsInstance(result, list)
        self.assertEqual(result[1]["type"], "file")
        self.assertEqual(result[1]["file"]["filename"], "paper.pdf")


class ChatDecodingTests(unittest.TestCase):
    def _request(self, **kwargs) -> chat.ChatRunRequest:
        base = dict(model="m", turns=[_turn("user", "hi")])
        base.update(kwargs)
        return chat.ChatRunRequest(**base)

    def test_local_default_temperature(self) -> None:
        self.assertEqual(chat._decoding(self._request())["temperature"], 0.2)

    def test_remote_default_temperature(self) -> None:
        self.assertEqual(chat._decoding(self._request(allow_remote=True))["temperature"], 0.6)

    def test_max_tokens_default_and_passthrough(self) -> None:
        self.assertEqual(chat._decoding(self._request())["max_tokens"], chat._DEFAULT_OUTPUT_TOKENS)
        self.assertEqual(chat._decoding(self._request(max_tokens=3000))["max_tokens"], 3000)

    def test_top_k_passthrough_only_when_set(self) -> None:
        self.assertNotIn("top_k", chat._decoding(self._request()))
        self.assertEqual(chat._decoding(self._request(top_k=20))["top_k"], 20)


class ChatValidationTests(unittest.TestCase):
    def test_empty_turns_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            chat._validate_turns([])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_last_turn_must_be_user(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            chat._validate_turns([_turn("user", "hi"), _turn("assistant", "bye")])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_non_image_data_url_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            chat._validate_turns([_turn("user", "x", images=["data:text/plain;base64,QUJD"])])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_too_many_images_rejected(self) -> None:
        many = [_TINY_PNG_DATA_URL] * (chat._MAX_IMAGES_PER_TURN + 1)
        with self.assertRaises(HTTPException) as ctx:
            chat._validate_turns([_turn("user", "x", images=many)])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_invalid_file_data_url_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            chat._validate_turns(
                [_turn("user", "x", files=[("paper.pdf", "not-base64")])]
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_too_many_files_rejected(self) -> None:
        many = [
            (f"paper-{index}.pdf", _TINY_PDF_DATA_URL)
            for index in range(chat._MAX_FILES_PER_TURN + 1)
        ]
        with self.assertRaises(HTTPException) as ctx:
            chat._validate_turns([_turn("user", "x", files=many)])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_total_file_size_limit_is_enforced(self) -> None:
        with (
            mock.patch.object(chat, "_MAX_TOTAL_FILE_DATA_URL_CHARS", 10),
            self.assertRaises(HTTPException) as ctx,
        ):
            chat._validate_turns(
                [_turn("user", "x", files=[("paper.pdf", _TINY_PDF_DATA_URL)])]
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_valid_turns_pass(self) -> None:
        turns = chat._validate_turns([_turn("user", "hi", images=[_TINY_PNG_DATA_URL])])
        self.assertEqual(len(turns), 1)


class ChatRunTests(unittest.TestCase):
    def test_run_chat_forwards_prompt_cache_key_and_cached_tokens(self) -> None:
        captured: dict[str, object] = {}

        def fake_runner(payload):
            captured["payload"] = payload
            return {
                "id": "resp_1",
                "model": "m",
                "output_text": "ok",
                "metrics": {
                    "engine_prompt_tokens": 120,
                    "engine_cached_prompt_tokens": 100,
                },
            }, 12.0

        request = chat.ChatRunRequest(
            model="m",
            turns=[_turn("user", "hi")],
            prompt_cache_key="chat-123",
        )
        with mock.patch.object(chat, "_run_prompt_runner_payload", side_effect=fake_runner):
            response = chat.run_chat(request)

        self.assertEqual(captured["payload"]["prompt_cache_key"], "chat-123")
        self.assertEqual(response.metrics["engine_prompt_tokens"], 120)
        self.assertEqual(response.metrics["engine_cached_prompt_tokens"], 100)

    def test_run_chat_forwards_thinking_mode(self) -> None:
        captured: dict[str, object] = {}

        def fake_runner(payload):
            captured["payload"] = payload
            return {"id": "resp_1", "model": "m", "output_text": "ok", "metrics": {}}, 12.0

        request = chat.ChatRunRequest(
            model="m",
            turns=[_turn("user", "hi")],
            thinking="enabled",
        )
        with mock.patch.object(chat, "_run_prompt_runner_payload", side_effect=fake_runner):
            response = chat.run_chat(request)

        self.assertEqual(response.output_text, "ok")
        self.assertEqual(captured["payload"]["thinking"], "enabled")

    def test_run_chat_forwards_native_file(self) -> None:
        captured: dict[str, object] = {}

        def fake_runner(payload):
            captured["payload"] = payload
            return {"id": "resp_1", "model": "m", "output_text": "ok", "metrics": {}}, 12.0

        request = chat.ChatRunRequest(
            model="m",
            turns=[
                _turn(
                    "user",
                    "Summarize this.",
                    files=[("paper.pdf", _TINY_PDF_DATA_URL)],
                )
            ],
        )
        with mock.patch.object(chat, "_run_prompt_runner_payload", side_effect=fake_runner):
            chat.run_chat(request)

        content = captured["payload"]["messages"][0]["content"]
        self.assertEqual(content[1]["type"], "file")
        self.assertEqual(content[1]["file"]["file_data"], _TINY_PDF_DATA_URL)


if __name__ == "__main__":
    unittest.main()
