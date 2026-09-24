from __future__ import annotations

import json
import unittest
from unittest import mock
from urllib import error

from app.realtime_translation.replay.prompt_selection import PromptLoadError
from app.realtime_translation.replay.prompt_selection import _load_prompt

URLOPEN = "app.realtime_translation.replay.prompt_selection.request.urlopen"


class _Response:
    """The part of an http.client response the loader uses."""

    def __init__(self, payload: dict[str, object] | bytes) -> None:
        self._body = payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None

    def read(self) -> bytes:
        return self._body


def _http_error(code: int) -> error.HTTPError:
    return error.HTTPError("http://translation-services/v1/prompts/x", code, "err", {}, None)  # type: ignore[arg-type]


class PromptLoadStatusTests(unittest.TestCase):
    """Which status the loader picks, so the routes can hand it to the client unchanged.

    The routes carry the status of a ``PromptLoadError`` out (`_set_session_prompt`) or replace it
    with 502 (`create_session`), so nothing above this layer decides whether a missing prompt is a
    404 or an upstream failure. That decision lives here and is pinned here: a route test injects
    the exception and can therefore not see it.
    """

    def _status_code(self, side_effect: BaseException) -> int:
        with mock.patch(URLOPEN, side_effect=side_effect):
            with self.assertRaises(PromptLoadError) as caught:
                _load_prompt("translate_realtime_first")
        return caught.exception.status_code

    def _status_code_for_answer(self, body: bytes) -> int:
        with mock.patch(URLOPEN, return_value=_Response(body)):
            with self.assertRaises(PromptLoadError) as caught:
                _load_prompt("translate_realtime_first")
        return caught.exception.status_code

    def test_prompt_the_library_does_not_have_is_a_404(self) -> None:
        self.assertEqual(self._status_code(_http_error(404)), 404)

    def test_http_error_from_the_service_is_a_502(self) -> None:
        # 403 and 400 belong here too: only a 404 from the library means "no such prompt".
        for code in (400, 403, 500, 503):
            with self.subTest(code=code):
                self.assertEqual(self._status_code(_http_error(code)), 502)

    def test_unreachable_service_is_a_502(self) -> None:
        self.assertEqual(self._status_code(error.URLError("connection refused")), 502)

    def test_timeout_is_a_502(self) -> None:
        self.assertEqual(self._status_code(TimeoutError("timed out")), 502)

    def test_answer_that_cannot_be_read_is_a_502(self) -> None:
        # What a proxy or a wrong port in front of the service answers with.
        for label, body in [
            ("not json", b"{niet json"),
            ("html", b"<html><body>502</body></html>"),
            ("empty", b""),
            ("not utf-8", b"\xff\xfe\x00"),
        ]:
            with self.subTest(answer=label):
                self.assertEqual(self._status_code_for_answer(body), 502)

    def test_answer_that_is_not_a_prompt_is_a_502(self) -> None:
        for label, body, type_name in [("a list", b"[1, 2, 3]", "list"), ("a string", b'"tekst"', "str")]:
            with self.subTest(answer=label):
                with mock.patch(URLOPEN, return_value=_Response(body)):
                    with self.assertRaises(PromptLoadError) as caught:
                        _load_prompt("translate_realtime_first")

                self.assertEqual(caught.exception.status_code, 502)
                self.assertIn(type_name, str(caught.exception))

    def test_the_reason_travels_with_the_status(self) -> None:
        with mock.patch(URLOPEN, side_effect=_http_error(404)):
            with self.assertRaises(PromptLoadError) as caught:
                _load_prompt("translate_realtime_first")

        self.assertIn("translate_realtime_first", str(caught.exception))

    def test_a_client_supplied_id_cannot_reshape_the_upstream_request(self) -> None:
        with mock.patch(URLOPEN, side_effect=_http_error(404)) as urlopen:
            with self.assertRaises(PromptLoadError):
                _load_prompt("../../v1/models")

        upstream = urlopen.call_args.args[0]
        self.assertTrue(upstream.full_url.endswith("/v1/prompts/..%2F..%2Fv1%2Fmodels"), upstream.full_url)
        self.assertEqual(upstream.get_method(), "GET")
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 5.0)

    def test_an_answer_from_the_library_becomes_a_prompt_record(self) -> None:
        payload = {"id": "translate_realtime_first", "title": "First", "user": "u", "system": "s"}
        with mock.patch(URLOPEN, return_value=_Response(payload)):
            record = _load_prompt("translate_realtime_first")

        self.assertEqual(record.id, "translate_realtime_first")
        self.assertEqual(record.prompt_text, "u")
        self.assertEqual(record.system_prompt, "s")


if __name__ == "__main__":
    unittest.main()
