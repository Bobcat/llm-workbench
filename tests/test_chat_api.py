from __future__ import annotations

import unittest

from fastapi import HTTPException

from app.prompt_testing import chat


_TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _turn(role: str, text: str = "", images=None) -> chat.ChatTurnInput:
    return chat.ChatTurnInput(
        role=role,
        text=text,
        images=[chat.ChatImageInput(data_url=url) for url in (images or [])],
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

    def test_valid_turns_pass(self) -> None:
        turns = chat._validate_turns([_turn("user", "hi", images=[_TINY_PNG_DATA_URL])])
        self.assertEqual(len(turns), 1)


if __name__ == "__main__":
    unittest.main()
