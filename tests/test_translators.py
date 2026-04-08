from __future__ import annotations

import unittest
from unittest.mock import patch

from app.translators import DummyTranslator
from app.translators import build_translator


class BuildTranslatorTests(unittest.TestCase):
    def test_build_translator_dummy_returns_dummy_translator(self) -> None:
        translator = build_translator("dummy", dummy_mode="echo")
        self.assertIsInstance(translator, DummyTranslator)
        self.assertEqual(translator.mode, "echo")

    def test_build_translator_ct2_uses_ct2_eurollm_translator(self) -> None:
        marker = object()
        with patch("app.translators.Ct2EuroLlmTranslator", return_value=marker):
            translator = build_translator("ct2-eurollm")
        self.assertIs(translator, marker)

    def test_build_translator_rejects_unknown_name(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported translator"):
            build_translator("unknown-backend")


if __name__ == "__main__":
    unittest.main()
