from __future__ import annotations

import unittest
from unittest.mock import patch

from app.__main__ import main


class CliEntrypointTests(unittest.TestCase):
    def test_main_runs_uvicorn_for_app_main(self) -> None:
        with patch("app.__main__.uvicorn.run") as run_mock:
            result = main()

        self.assertEqual(result, 0)
        run_mock.assert_called_once_with("app.main:app", host="127.0.0.1", port=8000)


if __name__ == "__main__":
    unittest.main()
