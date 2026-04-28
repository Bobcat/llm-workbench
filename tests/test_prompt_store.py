from __future__ import annotations

from dataclasses import dataclass
import importlib
import sys
import types
import unittest
from unittest.mock import Mock, patch


def _engine_stub() -> types.ModuleType:
    module = types.ModuleType("realtime_translation_engine")

    @dataclass(frozen=True)
    class PreviewTranslationSettings:
        enabled: bool = True
        min_chars: int = 80
        max_distance_ratio: float = 0.15
        min_growth_chars: int = 50

    module.PreviewTranslationSettings = PreviewTranslationSettings
    return module


class PromptStoreTests(unittest.TestCase):
    def test_get_prompt_library_store_is_lazy_and_cached(self) -> None:
        module_name = "app.realtime_translation.prompt_library.store"
        settings_module_name = "app.realtime_translation.replay.settings"
        previous_store_module = sys.modules.pop(module_name, None)
        previous_settings_module = sys.modules.pop(settings_module_name, None)
        previous_engine_module = sys.modules.get("realtime_translation_engine")
        sys.modules["realtime_translation_engine"] = _engine_stub()
        factory = Mock(name="FilePromptLibraryStore")
        fake_store = object()
        factory.return_value = fake_store

        try:
            with patch("promptlib.FilePromptLibraryStore", factory):
                store_module = importlib.import_module(module_name)
                factory.assert_not_called()

                first_store = store_module.get_prompt_library_store()
                second_store = store_module.get_prompt_library_store()

            self.assertIs(first_store, fake_store)
            self.assertIs(second_store, fake_store)
            factory.assert_called_once_with(store_module.PROMPT_LIBRARY_ROOT)
        finally:
            if "store_module" in locals():
                store_module.get_prompt_library_store.cache_clear()
            sys.modules.pop(module_name, None)
            sys.modules.pop(settings_module_name, None)
            if previous_store_module is not None:
                sys.modules[module_name] = previous_store_module
            if previous_settings_module is not None:
                sys.modules[settings_module_name] = previous_settings_module
            if previous_engine_module is not None:
                sys.modules["realtime_translation_engine"] = previous_engine_module
            else:
                sys.modules.pop("realtime_translation_engine", None)


if __name__ == "__main__":
    unittest.main()
