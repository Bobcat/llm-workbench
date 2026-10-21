from __future__ import annotations

import unittest
from unittest import mock

from app.translation_services import pdf


class PdfTranslationApiTests(unittest.TestCase):
    def test_recent_requests_proxies_the_translation_service_collection(self) -> None:
        payload = {"limit": 15, "requests": [{"request_id": "req_pdf"}]}
        with mock.patch.object(pdf, "_request_json", return_value=payload) as request_json:
            self.assertEqual(pdf.recent_requests(), payload)

        request_json.assert_called_once_with(
            method="GET",
            path="/v1/requests",
            timeout=15.0,
        )

    def test_a_rerender_goes_to_the_pdf_route(self) -> None:
        with mock.patch.object(pdf, "_request_json", return_value={}) as request_json:
            pdf.rerender_request("req_pdf", {"page_scale": 0.9})

        request_json.assert_called_once_with(
            method="POST",
            path="/v1/pdf-requests/req_pdf/rerender",
            payload={"page_scale": 0.9},
            timeout=60.0,
        )
