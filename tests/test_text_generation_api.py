from __future__ import annotations

import unittest
from unittest import mock

from fastapi import HTTPException

from app.prompt_testing import text_generation


_TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _request(**kwargs) -> text_generation.TextGenerationRunRequest:
    base = dict(model="m", user_prompt="hi")
    base.update(kwargs)
    return text_generation.TextGenerationRunRequest(**base)


class TextGenerationInputTests(unittest.TestCase):
    def test_text_only_input_is_plain_string(self) -> None:
        value = text_generation._text_generation_input("hello", [])
        self.assertEqual(value, "hello")

    def test_image_input_orders_text_then_images(self) -> None:
        image = text_generation.TextGenerationImageInput(
            name="a.png",
            data_url=_TINY_PNG_DATA_URL,
        )
        content = text_generation._text_generation_input("Describe this.", [image])
        self.assertIsInstance(content, list)
        self.assertEqual(content[0], {"type": "text", "text": "Describe this."})
        self.assertEqual(content[1]["type"], "image_url")
        self.assertEqual(content[1]["image_url"]["url"], _TINY_PNG_DATA_URL)

    def test_image_without_text_is_image_only(self) -> None:
        image = text_generation.TextGenerationImageInput(data_url=_TINY_PNG_DATA_URL)
        content = text_generation._text_generation_input("   ", [image])
        self.assertIsInstance(content, list)
        self.assertEqual(len(content), 1)
        self.assertEqual(content[0]["type"], "image_url")


class TextGenerationPayloadTests(unittest.TestCase):
    def test_payload_uses_string_input_without_images(self) -> None:
        request = _request(system_prompt="You answer shortly.")
        payload = text_generation._text_generation_payload(
            request,
            model="m",
            rendered_user_prompt="hi",
            images=[],
        )
        self.assertEqual(payload["input"], "hi")
        self.assertEqual(payload["instructions"], "You answer shortly.")
        self.assertEqual(payload["thinking"], "default")

    def test_payload_uses_polymorphic_list_input_with_images(self) -> None:
        image = text_generation.TextGenerationImageInput(data_url=_TINY_PNG_DATA_URL)
        request = _request()
        payload = text_generation._text_generation_payload(
            request,
            model="m",
            rendered_user_prompt="hi",
            images=[image],
        )
        self.assertIsInstance(payload["input"], list)
        self.assertEqual(payload["input"][0]["type"], "text")
        self.assertEqual(payload["input"][1]["type"], "image_url")

    def test_remote_uses_remote_temperature_default(self) -> None:
        remote = text_generation._decoding(_request(allow_remote=True))
        local = text_generation._decoding(_request(allow_remote=False))
        self.assertEqual(remote["temperature"], 0.6)
        self.assertEqual(local["temperature"], 0.2)

    def test_max_tokens_passes_through_and_clamps(self) -> None:
        default = text_generation._decoding(_request())
        explicit = text_generation._decoding(_request(max_tokens=3000))
        self.assertEqual(default["max_tokens"], text_generation._DEFAULT_OUTPUT_TOKENS)
        self.assertEqual(explicit["max_tokens"], 3000)

    def test_top_k_passthrough_only_when_set(self) -> None:
        self.assertNotIn("top_k", text_generation._decoding(_request()))
        self.assertEqual(text_generation._decoding(_request(top_k=20))["top_k"], 20)

    def test_thinking_mode_is_forwarded(self) -> None:
        request = _request(thinking="enabled")
        payload = text_generation._text_generation_payload(
            request,
            model="m",
            rendered_user_prompt="hi",
            images=[],
        )
        self.assertEqual(payload["thinking"], "enabled")


class TextGenerationValidationTests(unittest.TestCase):
    def test_no_images_is_allowed(self) -> None:
        self.assertEqual(text_generation._validate_images([]), [])

    def test_too_many_images_is_rejected(self) -> None:
        images = [
            text_generation.TextGenerationImageInput(data_url=_TINY_PNG_DATA_URL)
            for _ in range(text_generation._MAX_IMAGES + 1)
        ]
        with self.assertRaises(HTTPException) as ctx:
            text_generation._validate_images(images)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_non_image_data_url_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            text_generation._validate_images(
                [text_generation.TextGenerationImageInput(data_url="data:text/plain;base64,QUJD")]
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_non_base64_data_url_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            text_generation._validate_images(
                [text_generation.TextGenerationImageInput(data_url="data:image/png,rawbytes")]
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_valid_image_passes(self) -> None:
        images = text_generation._validate_images(
            [text_generation.TextGenerationImageInput(data_url=_TINY_PNG_DATA_URL)]
        )
        self.assertEqual(len(images), 1)


class TextGenerationRunTests(unittest.TestCase):
    def test_run_rejects_empty_prompt_without_files_or_images(self) -> None:
        request = text_generation.TextGenerationRunRequest(model="m", user_prompt=" ")
        with self.assertRaises(HTTPException) as ctx:
            text_generation.run_text_generation(request)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_run_accepts_image_without_text(self) -> None:
        captured: dict[str, object] = {}

        def fake_runner(payload):
            captured["payload"] = payload
            return {"id": "resp_1", "model": "m", "output_text": "ok", "metrics": {}}, 12.0

        request = text_generation.TextGenerationRunRequest(
            model="m",
            user_prompt=" ",
            images=[text_generation.TextGenerationImageInput(data_url=_TINY_PNG_DATA_URL)],
        )
        with mock.patch.object(
            text_generation,
            "_run_prompt_runner_payload",
            side_effect=fake_runner,
        ):
            response = text_generation.run_text_generation(request)

        self.assertEqual(response.output_text, "ok")
        self.assertEqual(response.image_count, 1)
        self.assertIsInstance(captured["payload"]["input"], list)


if __name__ == "__main__":
    unittest.main()
