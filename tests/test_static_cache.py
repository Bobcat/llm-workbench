from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from app.main import app


class StaticCacheControlTests(unittest.TestCase):
    """The frontend has no build step, so module URLs never change on an edit.

    Without Cache-Control the browser decides on its own how long it may reuse a module, which
    meant a stale view could survive a hard reload. These tests pin the fix and its scope.
    """

    def test_static_files_require_revalidation(self) -> None:
        client = TestClient(app)

        response = client.get("/app.js")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("cache-control"), "no-cache")
        self.assertIn("etag", response.headers)

    def test_index_is_served_with_revalidation(self) -> None:
        client = TestClient(app)

        response = client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("cache-control"), "no-cache")

    def test_unchanged_file_still_answers_not_modified(self) -> None:
        client = TestClient(app)
        first = client.get("/app.js")
        etag = first.headers["etag"]

        second = client.get("/app.js", headers={"If-None-Match": etag})

        self.assertEqual(second.status_code, 304)
        self.assertEqual(second.headers.get("cache-control"), "no-cache")

    def test_api_responses_are_left_alone(self) -> None:
        client = TestClient(app)

        response = client.get("/api/config/default-model")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("cache-control", response.headers)


if __name__ == "__main__":
    unittest.main()
