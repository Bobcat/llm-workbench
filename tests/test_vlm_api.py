from __future__ import annotations

import unittest

from fastapi import HTTPException

from app.prompt_testing import vlm


_TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


class VlmContentInputTests(unittest.TestCase):
    def test_content_input_orders_text_then_images(self) -> None:
        content = vlm._vlm_content_input(
            "Describe this.",
            [vlm.VlmImageInput(name="a.png", data_url=_TINY_PNG_DATA_URL)],
        )
        self.assertEqual(content[0], {"type": "text", "text": "Describe this."})
        self.assertEqual(content[1]["type"], "image_url")
        self.assertEqual(content[1]["image_url"]["url"], _TINY_PNG_DATA_URL)

    def test_content_input_without_text_is_images_only(self) -> None:
        content = vlm._vlm_content_input(
            "   ",
            [vlm.VlmImageInput(name="a.png", data_url=_TINY_PNG_DATA_URL)],
        )
        self.assertEqual(len(content), 1)
        self.assertEqual(content[0]["type"], "image_url")


class VlmPayloadTests(unittest.TestCase):
    def test_payload_uses_polymorphic_list_input(self) -> None:
        content = vlm._vlm_content_input("hi", [vlm.VlmImageInput(data_url=_TINY_PNG_DATA_URL)])
        payload = vlm._vlm_runner_payload(
            model="qwen2.5-vl-3b",
            system_prompt="You describe images.",
            content_input=content,
            allow_remote=False,
        )
        self.assertEqual(payload["model"], "qwen2.5-vl-3b")
        self.assertIsInstance(payload["input"], list)
        self.assertEqual(payload["instructions"], "You describe images.")
        self.assertFalse(payload["allow_remote"])
        self.assertFalse(payload["stream"])

    def test_remote_uses_moonshot_allowed_temperature(self) -> None:
        content = vlm._vlm_content_input("hi", [vlm.VlmImageInput(data_url=_TINY_PNG_DATA_URL)])
        remote = vlm._vlm_runner_payload(
            model="kimi-k2.6",
            system_prompt="",
            content_input=content,
            allow_remote=True,
        )
        local = vlm._vlm_runner_payload(
            model="qwen2.5-vl-3b",
            system_prompt="",
            content_input=content,
            allow_remote=False,
        )
        self.assertEqual(remote["decoding"]["temperature"], 0.6)
        self.assertEqual(local["decoding"]["temperature"], 0.2)

    def test_max_tokens_passes_through_and_clamps(self) -> None:
        content = vlm._vlm_content_input("hi", [vlm.VlmImageInput(data_url=_TINY_PNG_DATA_URL)])
        default = vlm._vlm_runner_payload(
            model="m", system_prompt="", content_input=content, allow_remote=False
        )
        explicit = vlm._vlm_runner_payload(
            model="m", system_prompt="", content_input=content, allow_remote=False, max_tokens=3000
        )
        over_cap = vlm._vlm_runner_payload(
            model="m", system_prompt="", content_input=content, allow_remote=False, max_tokens=99999
        )
        self.assertEqual(default["decoding"]["max_tokens"], vlm._DEFAULT_OUTPUT_TOKENS)
        self.assertEqual(explicit["decoding"]["max_tokens"], 3000)
        self.assertEqual(over_cap["decoding"]["max_tokens"], vlm._MAX_OUTPUT_TOKENS)

    def test_empty_system_prompt_becomes_space(self) -> None:
        content = vlm._vlm_content_input("hi", [vlm.VlmImageInput(data_url=_TINY_PNG_DATA_URL)])
        payload = vlm._vlm_runner_payload(
            model="m",
            system_prompt="",
            content_input=content,
            allow_remote=False,
        )
        self.assertEqual(payload["instructions"], " ")


class VlmValidationTests(unittest.TestCase):
    def test_no_images_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            vlm._validate_images([])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_too_many_images_is_rejected(self) -> None:
        images = [
            vlm.VlmImageInput(data_url=_TINY_PNG_DATA_URL)
            for _ in range(vlm._MAX_IMAGES + 1)
        ]
        with self.assertRaises(HTTPException) as ctx:
            vlm._validate_images(images)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_non_image_data_url_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            vlm._validate_images([vlm.VlmImageInput(data_url="data:text/plain;base64,QUJD")])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_non_base64_data_url_is_rejected(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            vlm._validate_images([vlm.VlmImageInput(data_url="data:image/png,rawbytes")])
        self.assertEqual(ctx.exception.status_code, 400)

    def test_valid_image_passes(self) -> None:
        images = vlm._validate_images([vlm.VlmImageInput(data_url=_TINY_PNG_DATA_URL)])
        self.assertEqual(len(images), 1)


if __name__ == "__main__":
    unittest.main()
