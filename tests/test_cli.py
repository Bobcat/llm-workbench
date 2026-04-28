from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

import app.__main__ as cli


class CliEntrypointTests(unittest.TestCase):
    def test_main_runs_uvicorn_for_app_main(self) -> None:
        uvicorn = Mock()
        with patch("app.__main__.import_module", return_value=uvicorn) as import_module_mock:
            result = cli.main()

        self.assertEqual(result, 0)
        import_module_mock.assert_called_once_with("uvicorn")
        uvicorn.run.assert_called_once_with("app.main:app", host="127.0.0.1", port=8000)


if __name__ == "__main__":
    unittest.main()
