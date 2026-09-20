"""The plugin registry: which sidebar categories and views exist.

This is the source of truth for the frontend menu. ``/plugins.js`` is generated from
:func:`frontend_script`, and ``static/index.html`` loads that file with a blocking script tag
before ``app.js`` runs.

A plugin is a menu entry and nothing more. The services the workbench talks to belong to the core:
``app/router.py`` mounts every router and ``app/main.py`` registers both websockets, always,
whatever this file says. So switching a category off changes what the sidebar shows and nothing
else. That is deliberate. Views do not stay inside their own category — five views outside LLM
Pool read their model list from ``/api/models`` — and the addresses they need are the core's, not
another category's.

Which categories are on is ``plugins.enabled`` in ``config/settings.json``, with
``config/local.json`` beside it as override; ``LLM_WORKBENCH_SETTINGS_FILE`` points at another file
altogether. See :func:`enabled_plugins`. Keeping the switch in settings rather than here is what
lets the regression pin in ``tests/test_plugin_registry.py`` keep pinning a constant.

Decisions behind the shape, and what was rejected, are in ``docs/plugin-architecture.md``.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

FRONTEND_GLOBAL = "__LLM_WORKBENCH_PLUGINS__"

# The environment variable is how a deployment keeps its settings outside the repo, and how the
# browser check drives the workbench against the shipped defaults on a machine that has switched
# categories off in config/local.json.
DEFAULT_SETTINGS_PATH = Path(
    os.environ.get(
        "LLM_WORKBENCH_SETTINGS_FILE",
        str(Path(__file__).resolve().parents[1] / "config" / "settings.json"),
    )
)


@dataclass(frozen=True)
class View:
    """One sidebar entry and the frontend module that renders it.

    ``module`` and ``factory`` are strings rather than the imported factory itself, so the whole
    registry stays serveable as data.
    """

    id: str
    route: str
    name: str
    icon: str
    module: str
    factory: str
    aliases: tuple[str, ...] = ()
    tooltip: str | None = None
    persistent: bool = True


@dataclass(frozen=True)
class Plugin:
    """One sidebar category, or one standalone item when ``auxiliary`` is set.

    ``id`` is the key in ``plugins.enabled``; it is not shown anywhere.
    """

    id: str
    label: str
    views: tuple[View, ...]
    auxiliary: bool = False


PLUGINS: tuple[Plugin, ...] = (
    Plugin(
        id="realtime-translation",
        label="Realtime Translation",
        views=(
            View(
                id="replay-translate",
                route="replay-translate",
                name="Replay & Translate",
                icon="languages",
                module="src/workflows/replay/index.js",
                factory="createReplayView",
            ),
        ),
    ),
    Plugin(
        id="realtime-tts",
        label="Realtime TTS",
        views=(
            View(
                id="replay-speak",
                route="replay-speak",
                name="Replay & Speak",
                icon="volume-2",
                module="src/workflows/replay-speak/index.js",
                factory="createReplaySpeakView",
            ),
        ),
    ),
    Plugin(
        id="llm-pool",
        label="LLM Pool",
        views=(
            View(
                id="llm-pool-models",
                route="llm-pool-models",
                name="Models",
                tooltip="LLM pool models",
                icon="pool-llm",
                module="src/workflows/llm-pool/index.js",
                factory="createLlmPoolView",
            ),
            View(
                id="text-generation",
                route="text-generation",
                name="Text generation",
                icon="file-plus",
                module="src/workflows/text-generation/index.js",
                factory="createTextGenerationView",
                aliases=("ad-hoc-prompt", "vlm-test"),
            ),
            View(
                id="chat",
                route="chat",
                name="Chat",
                icon="messages-square",
                module="src/workflows/chat/index.js",
                factory="createChatView",
            ),
        ),
    ),
    Plugin(
        id="tts-pool",
        label="TTS Pool",
        views=(
            View(
                id="tts-pool-models",
                route="tts-pool-models",
                name="Models",
                tooltip="TTS pool models",
                icon="pool-tts",
                module="src/workflows/tts-pool/index.js",
                factory="createTtsPoolView",
            ),
        ),
    ),
    Plugin(
        id="image-pool",
        label="Image Pool",
        views=(
            View(
                id="image-pool-models",
                route="image-pool-models",
                name="Models",
                tooltip="Image pool models",
                icon="pool-image",
                module="src/workflows/image-pool/index.js",
                factory="createImagePoolView",
            ),
            View(
                id="image-generation",
                route="image-generation",
                name="Image generation",
                icon="image-plus",
                module="src/workflows/image-generation/index.js",
                factory="createImageGenerationView",
            ),
            View(
                id="image-lora-library",
                route="image-lora-library",
                name="LoRA Library",
                icon="layers-3",
                module="src/workflows/lora-library/index.js",
                factory="createLoraLibraryView",
            ),
            View(
                id="image-train",
                route="image-train",
                name="Tuning",
                icon="sliders-horizontal",
                module="src/workflows/image-train/index.js",
                factory="createImageTrainView",
            ),
        ),
    ),
    Plugin(
        id="video-pool",
        label="Video Pool",
        views=(
            View(
                id="video-pool-models",
                route="video-pool-models",
                name="Models",
                tooltip="Video pool models",
                icon="pool-video",
                module="src/workflows/video-pool/index.js",
                factory="createVideoPoolView",
            ),
            View(
                id="video-generation",
                route="video-generation",
                name="Video generation",
                icon="video-plus",
                module="src/workflows/video-generation/index.js",
                factory="createVideoGenerationView",
            ),
        ),
    ),
    Plugin(
        id="translation-services",
        label="Translation Services",
        views=(
            View(
                id="image-translation",
                route="image-translation",
                name="Image translation",
                icon="image",
                module="src/workflows/translation-requests/index.js",
                factory="createTranslationRequestsView",
                aliases=("translation-requests",),
            ),
            View(
                id="image-translation-regression",
                route="image-translation-regression",
                name="Image regression testing",
                icon="clipboard-check",
                module="src/workflows/image-translation-regression/index.js",
                factory="createImageTranslationRegressionView",
                aliases=("translation-regression",),
            ),
            View(
                id="pdf-translation",
                route="pdf-translation",
                name="PDF translation",
                icon="file-text",
                module="src/workflows/pdf-translation/index.js",
                factory="createPdfTranslationView",
            ),
            View(
                id="pdf-translation-regression",
                route="pdf-translation-regression",
                name="PDF regression testing",
                icon="clipboard-check",
                module="src/workflows/pdf-translation-regression/index.js",
                factory="createPdfTranslationRegressionView",
            ),
            View(
                id="pdf-testing",
                route="pdf-testing",
                name="PDF benchmark",
                icon="gauge",
                module="src/workflows/pdf-testing/index.js",
                factory="createPdfTestingView",
            ),
            View(
                id="pdf-anatomy",
                route="pdf-anatomy",
                name="PDF anatomy",
                icon="venetian-mask",
                module="src/workflows/pdf-anatomy/index.js",
                factory="createPdfAnatomyView",
            ),
            View(
                id="prompt-library",
                route="prompt-library",
                name="Prompt Library",
                icon="book-open-text",
                module="src/workflows/translation-prompts/index.js",
                factory="createTranslationPromptsView",
            ),
        ),
    ),
    Plugin(
        id="developer",
        label="",
        auxiliary=True,
        views=(
            View(
                id="icons",
                route="icons",
                name="Icons",
                icon="shapes",
                module="src/workflows/icons/index.js",
                factory="createIconsView",
                persistent=False,
            ),
        ),
    ),
)


def iter_views() -> tuple[View, ...]:
    """Every view, in sidebar order, whether its category is on or not."""
    return tuple(view for plugin in PLUGINS for view in plugin.views)


def _load_json_object(path: Path) -> dict[str, object]:
    # A local copy of the loader the service settings use, six of which already exist. Folding
    # them into one module is a cleanup of its own; it is not part of this switch.
    if not path.exists():
        return {}
    raw_text = path.read_text(encoding="utf-8")
    if raw_text.strip() == "":
        return {}
    payload = json.loads(raw_text)
    if not isinstance(payload, dict):
        return {}
    return dict(payload)


def _merge_json_objects(base: dict[str, object], override: dict[str, object]) -> dict[str, object]:
    merged: dict[str, object] = dict(base)
    for key, value in override.items():
        base_value = merged.get(key)
        if isinstance(base_value, dict) and isinstance(value, dict):
            merged[key] = _merge_json_objects(base_value, value)
        else:
            merged[key] = value
    return merged


def enabled_plugins(settings_path: Path | str = DEFAULT_SETTINGS_PATH) -> tuple[Plugin, ...]:
    """The categories that are in the menu, in registry order.

    Without a ``plugins.enabled`` list every category is on, so a category added to this file shows
    up by itself. With one, exactly the ids it names are on: that is what makes a single-category
    workbench a one-line setting.

    An id the registry does not know is an error rather than a silently shorter menu, and so is an
    empty list: a typo, or a list someone forgot to fill in, would otherwise look like a working
    install that happens to miss a category. Either one shows the existing "plugin list did not
    arrive" panel in the browser.

    The settings are read per call, so switching a category does not need a restart: a page reload
    is enough.
    """
    path = Path(settings_path)
    payload = _merge_json_objects(
        _load_json_object(path),
        _load_json_object(path.with_name("local.json")),
    )
    plugins_payload = payload.get("plugins")
    enabled = plugins_payload.get("enabled") if isinstance(plugins_payload, dict) else None
    if enabled is None:
        return PLUGINS
    if not isinstance(enabled, list) or not all(isinstance(entry, str) for entry in enabled):
        raise ValueError(f"plugins.enabled in {path} must be a list of category ids")
    if not enabled:
        raise ValueError(f"plugins.enabled in {path} is empty, which would leave no menu at all")

    known = {plugin.id for plugin in PLUGINS}
    unknown = sorted({entry for entry in enabled if entry not in known})
    if unknown:
        raise ValueError(
            f"plugins.enabled in {path} names unknown categories: {', '.join(unknown)}"
        )

    wanted = set(enabled)
    return tuple(plugin for plugin in PLUGINS if plugin.id in wanted)


def route_aliases() -> dict[str, str]:
    """Retired route names, mapped to the route that replaced them.

    Aliases travel with their view, so a category that is off also retires its aliases: the
    frontend builds this table from the payload it receives.
    """
    return {
        alias: view.route
        for view in iter_views()
        for alias in view.aliases
    }


def frontend_payload(
    settings_path: Path | str = DEFAULT_SETTINGS_PATH,
) -> list[dict[str, object]]:
    """The menu as the browser needs it: data only, no router objects, enabled categories only."""
    return [
        {
            "id": plugin.id,
            "label": plugin.label,
            "auxiliary": plugin.auxiliary,
            "views": [
                {
                    "id": view.id,
                    "route": view.route,
                    "name": view.name,
                    "icon": view.icon,
                    "tooltip": view.tooltip,
                    "persistent": view.persistent,
                    "module": view.module,
                    "factory": view.factory,
                    "aliases": list(view.aliases),
                }
                for view in plugin.views
            ],
        }
        for plugin in enabled_plugins(settings_path)
    ]


def frontend_script(settings_path: Path | str = DEFAULT_SETTINGS_PATH) -> str:
    """The generated ``/plugins.js``: one global, loaded before ``app.js``.

    Served synchronously rather than fetched, because the list does not change during a session
    and a fetch would only add an empty-sidebar state to design for.
    """
    payload = json.dumps(
        frontend_payload(settings_path),
        ensure_ascii=True,
        separators=(",", ":"),
    )
    return f"window.{FRONTEND_GLOBAL} = {payload};\n"
