from __future__ import annotations

import unittest
from unittest import mock

from app.translation_services import proxy


class ImageTranslationApiTests(unittest.TestCase):
    def test_the_re_entries_go_to_the_image_route(self) -> None:
        for name in ("retranslate", "rerender"):
            with mock.patch.object(proxy, "_request_json", return_value={}) as request_json:
                getattr(proxy, f"{name}_request")("req_image", {"target_lang_code": "de"})

            request_json.assert_called_once_with(
                method="POST",
                path=f"/v1/image-requests/req_image/{name}",
                payload={"target_lang_code": "de"},
                timeout=60.0,
            )
