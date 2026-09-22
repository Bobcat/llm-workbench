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
import posixpath
import re
from dataclasses import dataclass
from urllib.parse import unquote
from importlib.metadata import entry_points
from pathlib import Path

from fastapi import APIRouter
from app.settings_files import load_object_or_raise, merge_objects

FRONTEND_GLOBAL = "__LLM_WORKBENCH_PLUGINS__"
# Where a package registers itself, and the path prefix its frontend files are served under.
ENTRY_POINT_GROUP = "llm_workbench.plugins"
# The id ends up in the mount path and in the frontend's icon pattern, so it has to be a shape both
# can live with. A space or a capital would mount fine and then break the sidebar.
PLUGIN_ID_PATTERN = re.compile(r"^[a-z0-9-]+$")
PACKAGE_MOUNT_PREFIX = "plugin-static"

# The environment variable is how a deployment keeps its settings outside the repo, and how the
# browser check drives the workbench against the shipped defaults on a machine that has switched
# categories off in config/local.json. It is read here, at import; the file's contents are read per
# call, so switching a category needs a page reload and not a restart.
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

    ``id`` is the key in ``plugins.enabled``; it is not shown anywhere. ``styles`` is for plugins
    from an installed package: the shell loads those stylesheets for an enabled plugin, and the
    registry's own plugins leave it empty.
    """

    id: str
    label: str
    views: tuple[View, ...]
    auxiliary: bool = False
    styles: tuple[str, ...] = ()


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
    """Every view of the registry's own plugins, in sidebar order.

    This is the set the hand-written sidebar pin measures; what discovery finds is covered by
    :func:`all_plugins`, which the analyses use.
    """
    return tuple(view for plugin in PLUGINS for view in plugin.views)


@dataclass(frozen=True)
class PluginPackage:
    """A plugin that an installed package brought along, with what the core has to mount.

    The registry's own plugins don't use this: their routers are mounted by ``app/router.py`` and
    their files are served from ``static/``. A package brings its addresses and its frontend files
    along, and the core mounts both — the same rule as for the registry's own plugins, where the
    core owns every address.
    """

    plugin: Plugin
    static_dir: Path
    routers: tuple[APIRouter, ...] = ()


_DISCOVERED: tuple[PluginPackage, ...] | None = None


def _discover_packages() -> tuple[PluginPackage, ...]:
    """Every installed package that registered itself, sorted by plugin id.

    The factory runs here, at import time, because that is when the mounts are built. Every problem
    raises with the entry point named: one broken package must not leave the workbench half-built,
    and silently skipping it would look like the plugin was never installed.
    """
    found: list[PluginPackage] = []
    for entry_point in sorted(entry_points(group=ENTRY_POINT_GROUP), key=lambda item: item.name):
        named = f"{entry_point.name} ({entry_point.value})"
        try:
            package = entry_point.load()()
        except Exception as error:  # noqa: BLE001 - reported as a load failure, with the name
            raise ValueError(f"plugin entry point {named} failed to load: {error}") from error
        if not isinstance(package, PluginPackage):
            raise ValueError(f"plugin entry point {named} did not return a PluginPackage")
        _validate_package(package, named)
        found.append(package)
    return tuple(sorted(found, key=lambda item: item.plugin.id))


def _checked_asset_path(plugin_id: str, value: str) -> bool:
    """Whether a path field stays inside the plugin's own mount.

    The browser is the reference here, not `posixpath`: it decodes percent escapes and treats a
    backslash as a separator, so ``%2e%2e/`` and ``..\\..`` leave the mount even though a raw
    comparison says they stay. The value is therefore decoded and normalised the way the URL parser
    does it, and only compared after that.
    """
    prefix = f"{PACKAGE_MOUNT_PREFIX}/{plugin_id}/"
    decoded = unquote(value).replace("\\", "/")
    normalised = posixpath.normpath(decoded)
    return normalised.startswith(prefix) and ".." not in normalised.split("/")


def _validate_package(package: PluginPackage, named: str) -> None:
    plugin = package.plugin
    if not PLUGIN_ID_PATTERN.match(plugin.id):
        raise ValueError(
            f"plugin id {plugin.id!r} from {named} must match {PLUGIN_ID_PATTERN.pattern}: it ends "
            "up in the mount path and in the frontend's icon pattern"
        )
    if not package.static_dir.is_dir():
        raise ValueError(
            f"plugin {plugin.id} from {named} has no static_dir at {package.static_dir}"
        )
    prefix = f"{PACKAGE_MOUNT_PREFIX}/{plugin.id}/"
    for view in plugin.views:
        if not _checked_asset_path(plugin.id, view.module):
            raise ValueError(
                f"view {view.route} of plugin {plugin.id} must live under {prefix}, "
                f"not {view.module}"
            )
        # An icon is either a sprite symbol or a file of this plugin. A path anywhere else is
        # refused here rather than rendering as a broken image or an unsafe value in the sidebar.
        if "/" in view.icon and not _checked_asset_path(plugin.id, view.icon):
            raise ValueError(
                f"icon {view.icon} of view {view.route} in plugin {plugin.id} must live under "
                f"{prefix}"
            )
    # Stylesheets are files of this plugin too: an external URL or a path outside the mount would
    # let a package pull in whatever it likes without the core noticing.
    for style in plugin.styles:
        if not _checked_asset_path(plugin.id, style):
            raise ValueError(
                f"style {style} of plugin {plugin.id} must live under {prefix}"
            )


def _check_collisions(packages: tuple[PluginPackage, ...]) -> None:
    """Refuse a duplicate plugin id or route instead of letting the last one win.

    With packages in play a collision is a runtime case rather than a typo in one file, and the
    frontend used to resolve it by silently keeping the last view. Failing at load names both sides.
    """
    plugins = PLUGINS + tuple(package.plugin for package in packages)
    ids: dict[str, int] = {}
    routes: dict[str, str] = {}
    for plugin in plugins:
        ids[plugin.id] = ids.get(plugin.id, 0) + 1
        for view in plugin.views:
            if view.route in routes and routes[view.route] != plugin.id:
                raise ValueError(
                    f"route {view.route} is declared by both {routes[view.route]} and {plugin.id}"
                )
            routes[view.route] = plugin.id
    duplicates = sorted(plugin_id for plugin_id, count in ids.items() if count > 1)
    if duplicates:
        raise ValueError(f"duplicate plugin id: {', '.join(duplicates)}")


def discovered_packages() -> tuple[PluginPackage, ...]:
    """What discovery found, read once and kept: the mounts are built at import."""
    global _DISCOVERED
    if _DISCOVERED is None:
        # Only cached after the collision check: a cache filled by a rejected load would answer the
        # next caller with the very set that was refused.
        discovered = _discover_packages()
        _check_collisions(discovered)
        _DISCOVERED = discovered
    return _DISCOVERED


def all_plugins() -> tuple[Plugin, ...]:
    """Every plugin that exists here: the registry's own first, then what packages brought."""
    return PLUGINS + tuple(package.plugin for package in discovered_packages())


def _enabled_entry(payload: dict[str, object]) -> object | None:
    """The raw ``plugins.enabled`` value of one settings file, before the two are merged."""
    section = payload.get("plugins")
    return section.get("enabled") if isinstance(section, dict) else None


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
    local_path = path.with_name("local.json")
    base_payload = load_object_or_raise(path)
    local_payload = load_object_or_raise(local_path)
    # A `plugins` section of the wrong shape is a mistake one level above `enabled`. Left alone it
    # would be merged away and the list beside it ignored, so the menu would show every category
    # while the reader believes their switch was applied. `null` counts as absent.
    for candidate_path, candidate_payload in ((path, base_payload), (local_path, local_payload)):
        section = candidate_payload.get("plugins")
        if section is not None and not isinstance(section, dict):
            raise ValueError(
                f"plugins in {candidate_path} must be an object, not {type(section).__name__}"
            )
    payload = merge_objects(base_payload, local_payload)
    enabled = _enabled_entry(payload)
    if enabled is None:
        return all_plugins()
    # Which of the two files the switch really came from. `local.json` wins from the base file and
    # is the documented place to switch categories off, so naming the base file unconditionally
    # sends the reader to the file where nothing is wrong.
    source = local_path if _enabled_entry(local_payload) is not None else path
    if not isinstance(enabled, list) or not all(isinstance(entry, str) for entry in enabled):
        raise ValueError(f"plugins.enabled in {source} must be a list of category ids")
    if not enabled:
        raise ValueError(f"plugins.enabled in {source} is empty, which would leave no menu at all")

    known = {plugin.id for plugin in all_plugins()}
    unknown = sorted({entry for entry in enabled if entry not in known})
    if unknown:
        raise ValueError(
            f"plugins.enabled in {source} names unknown categories: {', '.join(unknown)}"
        )

    wanted = set(enabled)
    return tuple(plugin for plugin in all_plugins() if plugin.id in wanted)


def route_aliases() -> dict[str, str]:
    """Retired route names, mapped to the route that replaced them.

    The tests pin this table; the browser builds its own from the payload it receives, which is why
    switching a category off also retires its aliases. This is the registry's own view of it.
    """
    return {
        alias: view.route
        for plugin in all_plugins()
        for view in plugin.views
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
            "styles": list(plugin.styles),
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
