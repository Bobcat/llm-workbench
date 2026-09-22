"""Tests for the shared settings-file helpers.

One module holds what used to be seven copies: a lenient loader for the service settings, a strict
one for the plugin switch, and the merge both of them use. The difference between the two loaders is
the point, so both are pinned here.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from app.settings_files import load_object, load_object_or_raise, merge_objects


def _write(tmp: str, name: str, content: str) -> Path:
    path = Path(tmp) / name
    path.write_text(content, encoding="utf-8")
    return path


class LenientLoaderTests(unittest.TestCase):
    """What the service settings want: anything unusable means "nothing configured here"."""

    def test_a_missing_file_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(load_object(Path(tmp) / "bestaat-niet.json"), {})

    def test_an_empty_file_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(load_object(_write(tmp, "leeg.json", "\n")), {})

    def test_a_file_that_is_not_an_object_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(load_object(_write(tmp, "lijst.json", '["image-pool"]')), {})

    def test_a_syntax_error_is_not_swallowed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write(tmp, "kapot.json", '{"a": }')
            with self.assertRaises(json.JSONDecodeError):
                load_object(path)

    def test_a_valid_file_is_read(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write(tmp, "goed.json", '{"llm_pool": {"base_url": "http://x"}}')
            self.assertEqual(load_object(path), {"llm_pool": {"base_url": "http://x"}})


class StrictLoaderTests(unittest.TestCase):
    """What the plugin switch wants: a file it cannot read must not look like "no switch here"."""

    def test_a_missing_or_empty_file_is_still_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(load_object_or_raise(Path(tmp) / "bestaat-niet.json"), {})
            self.assertEqual(load_object_or_raise(_write(tmp, "leeg.json", "")), {})

    def test_a_file_that_is_not_an_object_names_itself(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write(tmp, "lijst.json", '["image-pool"]')
            with self.assertRaises(ValueError) as raised:
                load_object_or_raise(path)
        self.assertIn("lijst.json", str(raised.exception))
        self.assertIn("JSON object", str(raised.exception))

    def test_a_syntax_error_names_itself(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = _write(tmp, "kapot.json", '{"a": }')
            with self.assertRaises(ValueError) as raised:
                load_object_or_raise(path)
        self.assertIn("kapot.json", str(raised.exception))
        self.assertIn("not valid JSON", str(raised.exception))


class MergeTests(unittest.TestCase):
    def test_nested_objects_merge_and_other_values_replace(self) -> None:
        base = {"plugins": {"enabled": ["a"]}, "llm_pool": {"base_url": "http://a", "tries": 1}}
        override = {"plugins": {"enabled": ["b"]}, "llm_pool": {"base_url": "http://b"}}

        merged = merge_objects(base, override)

        self.assertEqual(merged["plugins"], {"enabled": ["b"]})
        self.assertEqual(merged["llm_pool"], {"base_url": "http://b", "tries": 1})

    def test_a_new_key_is_added(self) -> None:
        self.assertEqual(merge_objects({"a": 1}, {"b": 2}), {"a": 1, "b": 2})

    def test_the_base_is_not_changed(self) -> None:
        base = {"a": {"b": 1}}
        merge_objects(base, {"a": {"b": 2}})
        self.assertEqual(base, {"a": {"b": 1}})


if __name__ == "__main__":
    unittest.main()
