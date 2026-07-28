from __future__ import annotations

import unittest
from unittest import mock

from fastapi.testclient import TestClient

from app.main import app


class PdfAnatomyApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_fixture_inventory_is_proxied(self) -> None:
        payload = {"documents": [{"name": "paper", "target_lang": "nl", "variant": "v1"}]}
        with mock.patch(
            "app.translation_services.pdf_anatomy._request_json",
            return_value=payload,
        ) as request_json:
            response = self.client.get("/api/pdf-anatomy/fixtures")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), payload)
        request_json.assert_called_once_with(
            method="GET",
            path="/v1/pdf-anatomy/fixtures",
            timeout=15.0,
        )

    def test_analysis_and_page_are_proxied(self) -> None:
        body = {"name": "paper", "target_lang": "nl", "variant": "v1"}
        with mock.patch(
            "app.translation_services.pdf_anatomy._request_json",
            side_effect=[
                {"analysis_id": "abc"},
                {"analysis_id": "abc", "page": 2},
            ],
        ) as request_json:
            analysis = self.client.post("/api/pdf-anatomy/analyses", json=body)
            page = self.client.get("/api/pdf-anatomy/analyses/abc/pages/2")

        self.assertEqual(analysis.status_code, 200)
        self.assertEqual(analysis.json()["analysis_id"], "abc")
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page.json()["page"], 2)
        self.assertEqual(
            request_json.call_args_list,
            [
                mock.call(
                    method="POST",
                    path="/v1/pdf-anatomy/analyses",
                    payload=body,
                    timeout=120.0,
                ),
                mock.call(
                    method="GET",
                    path="/v1/pdf-anatomy/analyses/abc/pages/2",
                    timeout=30.0,
                ),
            ],
        )

    def test_preview_is_proxied_as_binary(self) -> None:
        with mock.patch(
            "app.translation_services.pdf_anatomy._request_binary",
            return_value=(b"\x89PNG", "image/png"),
        ) as request_binary:
            response = self.client.get(
                "/api/pdf-anatomy/analyses/abc/pages/3/preview/translated"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"\x89PNG")
        self.assertEqual(response.headers["content-type"], "image/png")
        request_binary.assert_called_once_with(
            path="/v1/pdf-anatomy/analyses/abc/pages/3/preview/translated",
            timeout=60.0,
        )


if __name__ == "__main__":
    unittest.main()
