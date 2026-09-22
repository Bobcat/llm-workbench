"""Tests for the plugin registry — the sidebar's source of truth.

Three kinds of test live here:

- the **regression pin**: a hand-written copy of the shipped sidebar. It is deliberately not
  derived from `app.plugins`, so that a mistake in the registry shows up here instead of being
  copied along. If you add or rename a view on purpose, update this table too.
- the **independent checks**: the endpoints the views actually call are served, and every router
  module in `app/` is mounted. Those do not read the registry's own claims — that matters more
  since phase 3, where the core owns the addresses and a plugin is only a menu entry.
- the **switch checks**: `plugins.enabled` selects categories, and every category on its own still
  reaches every endpoint its views call. That last one is the promise of the core model: no
  category depends on another.

The JS suite covers what only a browser can: that each view module resolves, exports its named
factory, and that every icon exists in the sprite.
"""

from __future__ import annotations

import contextlib
import importlib
import json
import posixpath
import os
import re
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter
from fastapi.testclient import TestClient

from app import plugins as plugins_module
from app.main import app
from app.plugins import (
    PLUGINS,
    Plugin,
    View,
    all_plugins,
    enabled_plugins,
    frontend_payload,
    frontend_script,
    iter_views,
    route_aliases,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
STATIC = REPO_ROOT / "static"
PLUGIN_ROOT = STATIC / "src" / "plugins"
# The committed defaults, read directly rather than through app.plugins: that module resolves the
# path through `LLM_WORKBENCH_SETTINGS_FILE` and merges `config/local.json`, and the pins below are
# about what ships.
SHIPPED_SETTINGS = REPO_ROOT / "config" / "settings.json"

# The design document points at code by file and line. Those references are checked below, because
# three review rounds in a row found them stale after a code change shifted them.
ARCHITECTURE_DOC = REPO_ROOT / "docs" / "plugin-architecture.md"
REGISTRY_RELATIVE = "static/src/plugins/registry.js"
DOC_REFERENCE = re.compile(r"`([A-Za-z0-9_./-]+\.(?:js|py|html|css)):(\d+)(?:-(\d+))?`")
DOC_TABLE_ROW = re.compile(r"^\| `([A-Za-z_][A-Za-z0-9_]*)` \| (\d+) \|")
DOC_TOKEN = re.compile(r"`([^`]+)`")
DOC_LINE_SUFFIX = re.compile(r":\d+")
LITERAL_API_PATH = re.compile(r"['\"`](/api/[^'\"`]*)['\"`]")

# route, sidebar label, icon, persistent, tooltip, aliases
EXPECTED_SIDEBAR: list[tuple[str, list[tuple]]] = [
    ("Realtime Translation", [
        ("replay-translate", "Replay & Translate", "languages", True, None, ()),
    ]),
    ("Realtime TTS", [
        ("replay-speak", "Replay & Speak", "volume-2", True, None, ()),
    ]),
    ("LLM Pool", [
        ("llm-pool-models", "Models", "pool-llm", True, "LLM pool models", ()),
        ("text-generation", "Text generation", "file-plus", True, None, ("ad-hoc-prompt", "vlm-test")),
        ("chat", "Chat", "messages-square", True, None, ()),
    ]),
    ("TTS Pool", [
        ("tts-pool-models", "Models", "pool-tts", True, "TTS pool models", ()),
    ]),
    ("Image Pool", [
        ("image-pool-models", "Models", "pool-image", True, "Image pool models", ()),
        ("image-generation", "Image generation", "image-plus", True, None, ()),
        ("image-lora-library", "LoRA Library", "layers-3", True, None, ()),
        ("image-train", "Tuning", "sliders-horizontal", True, None, ()),
    ]),
    ("Video Pool", [
        ("video-pool-models", "Models", "pool-video", True, "Video pool models", ()),
        ("video-generation", "Video generation", "video-plus", True, None, ()),
    ]),
    ("Translation Services", [
        ("image-translation", "Image translation", "image", True, None, ("translation-requests",)),
        ("image-translation-regression", "Image regression testing", "clipboard-check", True, None, ("translation-regression",)),
        ("pdf-translation", "PDF translation", "file-text", True, None, ()),
        ("pdf-translation-regression", "PDF regression testing", "clipboard-check", True, None, ()),
        ("pdf-testing", "PDF benchmark", "gauge", True, None, ()),
        ("pdf-anatomy", "PDF anatomy", "venetian-mask", True, None, ()),
        ("prompt-library", "Prompt Library", "book-open-text", True, None, ()),
    ]),
]

EXPECTED_AUXILIARY: list[tuple] = [
    ("icons", "Icons", "shapes", False, None, ()),
]

EXPECTED_ALIASES = {
    "ad-hoc-prompt": "text-generation",
    "vlm-test": "text-generation",
    "translation-requests": "image-translation",
    "translation-regression": "image-translation-regression",
}


def _app_paths() -> set[str]:
    paths = set()
    for route in app.routes:
        path = getattr(route, "path", "")
        if path.startswith("/api"):
            paths.add(path)
    return paths


def _router_module_objects() -> dict[str, APIRouter]:
    """Every module under `app/` that defines a module-level `router`, imported.

    The core mounts these by hand; this finds them without reading `app/router.py`, so a service
    that is added to `app/` and forgotten there shows up as a failure instead of a 404 later.
    """
    routers: dict[str, APIRouter] = {}
    for path in sorted((REPO_ROOT / "app").rglob("*.py")):
        source = path.read_text(encoding="utf-8")
        if not re.search(r"^router = APIRouter\(", source, re.M):
            continue
        module_name = path.relative_to(REPO_ROOT).with_suffix("").as_posix().replace("/", ".")
        routers[module_name] = importlib.import_module(module_name).router
    return routers


@contextlib.contextmanager
def _settings(payload: object, local: object | None = None, raw: dict[str, str] | None = None):
    """A temporary `settings.json`, with a `local.json` beside it when one is given.

    The values are written as JSON, so a test can also hand in something a settings file should not
    be — a list, or a string where an object belongs. `raw` maps a file name to content written
    verbatim, for the one thing the writer cannot produce: a file that is not valid JSON at all.
    """
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "settings.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        if local is not None:
            (Path(tmp) / "local.json").write_text(json.dumps(local), encoding="utf-8")
        for name, content in (raw or {}).items():
            (Path(tmp) / name).write_text(content, encoding="utf-8")
        yield path


def _shipped_settings():
    """The committed settings in a directory of their own, with nothing beside them.

    A machine can switch categories off in `config/local.json`, which is gitignored, or point
    `LLM_WORKBENCH_SETTINGS_FILE` at another file. The pins below are about what ships, so they
    must not depend on either: a restricted install is a normal install, not a broken one.
    """
    return _settings(json.loads(SHIPPED_SETTINGS.read_text(encoding="utf-8")))


def _module_files(entry: Path) -> set[Path]:
    """Every file the view pulls in through relative imports, itself included.

    Since phase 4 that includes the client of its own plugin and whatever that imports from
    `shared/`, which is where the `/api` paths are written.
    """
    seen: set[Path] = set()
    stack = [entry]
    while stack:
        current = stack.pop()
        if current in seen or not current.exists():
            continue
        seen.add(current)
        source = current.read_text(encoding="utf-8", errors="replace")
        for specifier in re.findall(r"""from\s*['"](\.[^'"]+)['"]""", source):
            stack.append((current.parent / specifier).resolve())
    return seen


def _api_paths(entry: Path) -> set[str]:
    """Every `/api` path the view's own code builds, read as text.

    Until phase 4 this came out of `api-client.js` through a method → path table, because all the
    paths lived in one shared file. They now live in the subtree itself — the plugin's client plus
    what it imports from `shared/` — so the table is gone and this reads what is written. The
    `${...}` part of a template is cut off, because a view appends ids to a base.
    """
    found: set[str] = set()
    for file in _module_files(entry):
        source = file.read_text(encoding="utf-8", errors="replace")
        for literal in LITERAL_API_PATH.findall(source):
            literal = literal[: literal.find("${")] if "${" in literal else literal
            literal = literal.rstrip("/")
            if len(literal) > len("/api/"):
                found.add(literal)
    return found


def _socket_paths(entry: Path) -> set[str]:
    """The `/ws` paths the view's own code connects to."""
    found: set[str] = set()
    for file in _module_files(entry):
        source = file.read_text(encoding="utf-8", errors="replace")
        found.update(re.findall(r"/ws/[A-Za-z0-9/_-]*", source))
    return found


def _package_of(plugin_id: str):
    """The installed package behind a plugin id, or None for the registry's own plugins."""
    return next(
        (package for package in plugins_module.discovered_packages() if package.plugin.id == plugin_id),
        None,
    )


def _plugin_roots(plugin) -> tuple[Path, ...]:
    """The directories that belong to this plugin.

    A package brings its own ``static_dir``; a plugin from the registry owns its folder under
    ``src/plugins/``. Everything under ``static/src/shared/`` belongs to the core, so no plugin
    owns it.
    """
    package = _package_of(plugin.id)
    if package is not None:
        return (package.static_dir,)
    return (PLUGIN_ROOT / plugin.id,)


def _module_path(plugin, module: str) -> Path:
    """The file behind a view module: the plugin's own directory plus the part of the path it owns.

    A package serves `plugin-static/<id>/…` out of its `static_dir`, so the prefix stays in the
    browser and comes off here; a built-in module is a path under `static/`.
    """
    prefix = f"{plugins_module.PACKAGE_MOUNT_PREFIX}/{plugin.id}/"
    rest = module[len(prefix):] if module.startswith(prefix) else module
    package = _package_of(plugin.id)
    return (package.static_dir / rest) if package is not None else (STATIC / rest)


def _view_file(plugin, view) -> Path:
    """The file behind a view."""
    return _module_path(plugin, view.module)


def _client_owners(entry: Path) -> set[str]:
    """Which plugins the client modules in the view's subtree belong to.

    Ownership follows the same root as the analysis: a file under a plugin's own directory is that
    plugin's, and a file under `static/src/shared/` is the core's. A file that falls under neither
    is a mistake, not an empty answer — see the tests that use this.
    """
    owners: set[str] = set()
    for file in _module_files(entry):
        for plugin in all_plugins():
            if any(root == file or root in file.parents for root in _plugin_roots(plugin)):
                owners.add(plugin.id)
    return owners


def _prefix_is_served(prefix: str, app_paths: set[str]) -> bool:
    """A base URL is served when a route lives underneath it."""
    return any(
        candidate == prefix or candidate.startswith(prefix + "/") or candidate.startswith(prefix + "{")
        for candidate in app_paths
    )


def _is_served(path: str, app_paths: set[str]) -> bool:
    """A path is served when a route matches it, or when a route lives underneath it.

    The exact half catches a complete path that nothing serves; the prefix half is for a base the
    caller appends to, like `/api/pdf-regression` followed by `/fixtures`.
    """
    literal = path.split("?", 1)[0]
    if literal in app_paths:
        return True
    return _prefix_is_served(literal, app_paths)


def _registered_sockets() -> set[str]:
    return {
        getattr(route, "path", "")
        for route in app.routes
        if route.__class__.__name__ == "APIWebSocketRoute"
    }


class SidebarPinTests(unittest.TestCase):
    """The hand-written copy of the shipped sidebar."""

    def test_categories_and_views_match(self) -> None:
        actual = [
            (
                plugin.label,
                [
                    (
                        view.route,
                        view.name,
                        view.icon,
                        view.persistent,
                        view.tooltip,
                        tuple(view.aliases),
                    )
                    for view in plugin.views
                ],
            )
            for plugin in PLUGINS
            if not plugin.auxiliary
        ]
        self.assertEqual(actual, EXPECTED_SIDEBAR)

    def test_auxiliary_items_match(self) -> None:
        actual = [
            (view.route, view.name, view.icon, view.persistent, view.tooltip, tuple(view.aliases))
            for plugin in PLUGINS
            if plugin.auxiliary
            for view in plugin.views
        ]
        self.assertEqual(actual, EXPECTED_AUXILIARY)

    def test_aliases_match(self) -> None:
        self.assertEqual(route_aliases(), EXPECTED_ALIASES)


class RegistryInvariantTests(unittest.TestCase):
    def test_routes_and_view_ids_are_unique(self) -> None:
        routes = [view.route for view in iter_views()]
        ids = [view.id for view in iter_views()]
        self.assertEqual(len(set(routes)), len(routes))
        self.assertEqual(len(set(ids)), len(ids))

    def test_plugin_ids_are_unique(self) -> None:
        """They are the keys of `plugins.enabled`, so a duplicate would make the switch ambiguous."""
        ids = [plugin.id for plugin in PLUGINS]
        self.assertEqual(len(set(ids)), len(ids))

    def test_aliases_do_not_shadow_a_route(self) -> None:
        routes = {view.route for view in iter_views()}
        for alias in route_aliases():
            self.assertNotIn(alias, routes, f"alias {alias} shadows a real route")

    def test_alias_targets_exist(self) -> None:
        routes = {view.route for view in iter_views()}
        for alias, target in route_aliases().items():
            self.assertIn(target, routes, f"alias {alias} points at a missing route {target}")

    def test_payload_carries_only_frontend_data(self) -> None:
        with _shipped_settings() as settings_path:
            payload = frontend_payload(settings_path)
        for plugin in payload:
            self.assertEqual(set(plugin), {"id", "label", "auxiliary", "styles", "views"})
            for view in plugin["views"]:
                # The exact key set, so a field that cannot be serialised fails here instead of at
                # json.dumps.
                self.assertEqual(
                    set(view),
                    {
                        "id",
                        "route",
                        "name",
                        "icon",
                        "tooltip",
                        "persistent",
                        "module",
                        "factory",
                        "aliases",
                    },
                )


def _built_in_asset_problems(plugins) -> list[str]:
    """Built-in asset paths that do not name the plugin's own folder.

    A package has this check in the core (`_checked_asset_path`); a built-in plugin is core code and
    has none, so the rule is measured here instead of assumed. Without it a view of one plugin could
    quietly point at another plugin's file, and only the hand-written sidebar pin would notice.
    """
    problems: list[str] = []
    for plugin in plugins:
        prefix = f"src/plugins/{plugin.id}/"
        for view in plugin.views:
            if "/" in view.icon and not view.icon.startswith(prefix):
                problems.append(f"view {view.route}: icon {view.icon} is not under {prefix}")
        for style in plugin.styles:
            if not style.startswith(prefix):
                problems.append(f"plugin {plugin.id}: style {style} is not under {prefix}")
    return problems


class BuiltInAssetTests(unittest.TestCase):
    """A built-in plugin may bring its own stylesheet and its own icon file, like a package.

    The mechanism is the same for both: the payload carries `styles` and an icon may be a path, and
    the shell loads and renders them. What differs is the root — `src/plugins/<id>/` in the repo,
    `plugin-static/<id>/` for a package.
    """

    def test_styles_and_a_path_icon_reach_the_payload(self) -> None:
        built_in = Plugin(
            id="asset-probe",
            label="Asset probe",
            styles=("src/plugins/asset-probe/probe.css",),
            views=(
                View(
                    id="asset-probe-view",
                    route="asset-probe-view",
                    name="Probe",
                    icon="src/plugins/asset-probe/icon.svg",
                    module="src/workflows/probe/index.js",
                    factory="createProbeView",
                ),
            ),
        )
        with unittest.mock.patch.object(plugins_module, "PLUGINS", (built_in,)):
            payload = frontend_payload()

        self.assertEqual(payload[0]["styles"], ["src/plugins/asset-probe/probe.css"])
        self.assertEqual(payload[0]["views"][0]["icon"], "src/plugins/asset-probe/icon.svg")

    def test_every_built_in_asset_path_is_in_its_own_folder(self) -> None:
        self.assertEqual(_built_in_asset_problems(PLUGINS), [])

    def test_a_foreign_asset_path_is_reported(self) -> None:
        """The check on the check: a path that names another plugin's folder must be found."""
        stray = Plugin(
            id="stray",
            label="Stray",
            styles=("src/plugins/iemand-anders/stray.css",),
            views=(
                View(
                    id="stray-view",
                    route="stray-view",
                    name="Stray",
                    icon="src/plugins/iemand-anders/icon.svg",
                    module="src/workflows/stray/index.js",
                    factory="createStrayView",
                ),
            ),
        )
        problems = _built_in_asset_problems((stray,))
        self.assertEqual(len(problems), 2, problems)
        self.assertIn("src/plugins/stray/", problems[0])


class CoreMountTests(unittest.TestCase):
    """The core owns the addresses: every router module in `app/` is mounted, whatever is on.

    This is what replaced phase 2's per-view router declarations. A category switched off changes
    the sidebar and nothing else, so the set of mounted endpoints must not depend on the registry
    at all.
    """

    def test_the_router_scan_finds_the_routers(self) -> None:
        """A check on the check: a scan that finds nothing proves nothing."""
        found = _router_module_objects()
        self.assertGreaterEqual(len(found), 16, sorted(found))

    def test_every_router_module_is_mounted(self) -> None:
        mounted = _app_paths()
        for module_name, router in _router_module_objects().items():
            for route in router.routes:
                expected = "/api" + route.path
                self.assertTrue(
                    _is_served(expected, mounted),
                    f"{expected} from {module_name} is not mounted by the core",
                )

    def test_the_mounted_api_holds_nothing_else(self) -> None:
        """The mirror: no endpoint is mounted that the core or a package does not define.

        A plugin package brings its own routers — that is the promise of phase 5 — so they count as
        defined here, just as `all_plugins()` is the set the other analyses measure.
        """
        defined = {
            "/api" + route.path
            for router in _router_module_objects().values()
            for route in router.routes
        }
        for package in plugins_module.discovered_packages():
            defined |= {"/api" + route.path for router in package.routers for route in router.routes}
        self.assertEqual(_app_paths(), defined)


class ViewEndpointTests(unittest.TestCase):
    """Independent of the registry: the endpoints a view calls must actually be served.

    Since phase 3 that is the core's promise, so this measures against the mounted app. It does so
    per view rather than on the union, because a union stays green when one view's endpoints are
    served by a router mounted for something else — exactly the coupling this phase removed.
    """

    def test_views_only_build_paths_that_are_served(self) -> None:
        """Every `/api` path a view's own code writes must be served by a mounted route.

        Measured on the text, per view: the client of the view's own plugin, whatever that imports
        from `shared/`, and the URLs a view builds by hand for downloads and streams.
        """
        app_paths = _app_paths()
        for plugin in all_plugins():
            for view in plugin.views:
                paths = _api_paths(_view_file(plugin, view))
                for path in sorted(paths):
                    self.assertTrue(
                        _is_served(path, app_paths),
                        f"view {view.route} builds {path}, which no mounted route serves",
                    )

    def test_the_path_analysis_finds_something(self) -> None:
        """A check on the analysis itself: if it finds nothing, it proves nothing."""
        with_paths = [
            view.route
            for plugin in all_plugins()
            for view in plugin.views
            if _api_paths(_view_file(plugin, view))
        ]
        self.assertGreaterEqual(len(with_paths), 18, f"only found paths for {with_paths}")

    def test_the_only_view_without_endpoints_is_icons(self) -> None:
        """`icons` is frontend-only, and no other view quietly lost its backend."""
        empty = sorted(
            view.route
            for plugin in all_plugins()
            for view in plugin.views
            if not _api_paths(_view_file(plugin, view))
        )
        self.assertEqual(empty, ["icons"])

    def test_other_views_reach_at_least_two_endpoints(self) -> None:
        """A smoke check on the analysis itself: if it finds nothing, it proves nothing."""
        counts = {
            view.route: len(_api_paths(_view_file(plugin, view)))
            for plugin in all_plugins()
            for view in plugin.views
            if view.route != "icons"
        }
        thin = {route: count for route, count in counts.items() if count < 2}
        self.assertEqual(thin, {})

    def test_a_single_category_menu_still_reaches_the_endpoints_its_views_call(self) -> None:
        """What a one-category workbench promises, measured per category.

        Switch everything off except one category and the views that remain must still reach every
        endpoint they call — including the model list that the LLM Pool service serves, which five
        views outside LLM Pool use. That is what "a workbench with one category works" means, and
        it is why the addresses live with the core instead of with the plugins.

        The mounted set is deliberately the same on every iteration: `_app_paths()` reads the app
        that was built at import and never sees the switch. That "switching categories cannot change
        what is mounted" is what `CoreMountTests` guards; what this loop adds per category is the
        payload — only that category is in the menu, and its views still reach everything.
        """
        app_paths = _app_paths()
        plugin_by_id = {item.id: item for item in all_plugins()}
        for plugin in all_plugins():
            with self.subTest(category=plugin.id):
                with _settings({"plugins": {"enabled": [plugin.id]}}) as settings_path:
                    payload = frontend_payload(settings_path)
                    self.assertEqual([entry["id"] for entry in payload], [plugin.id])
                    views = [view for entry in payload for view in entry["views"]]
                    self.assertTrue(views, f"{plugin.id} has no views")
                    for view in views:
                        route = str(view["route"])
                        entry = plugin_by_id[str(plugin.id)]
                        for path in sorted(_api_paths(_module_path(entry, str(view["module"])))):
                            self.assertTrue(
                                _is_served(path, app_paths),
                                f"view {route} builds {path}, which no mounted route serves",
                            )


# The trees a module may reach into without leaving its own plugin: the shared helpers and the shell.
CORE_TREES = (STATIC / "src" / "shared", STATIC / "foundation")


def _plugin_url_prefix(plugin) -> str:
    """The URL space of a plugin: its own mount for a package, its folder for a built-in."""
    if _package_of(plugin.id) is not None:
        return f"/{plugins_module.PACKAGE_MOUNT_PREFIX}/{plugin.id}/"
    return f"/src/plugins/{plugin.id}/"


def _url_of(plugin, file: Path) -> str:
    """The URL the browser would load this file from, which is what imports resolve against."""
    package = _package_of(plugin.id)
    if package is not None:
        return f"/{plugins_module.PACKAGE_MOUNT_PREFIX}/{plugin.id}/{file.relative_to(package.static_dir).as_posix()}"
    return f"/{file.relative_to(STATIC).as_posix()}"


def _file_of(plugin, url: str) -> Path | None:
    """The file behind a URL, or None when it is not one this plugin can read."""
    package = _package_of(plugin.id)
    prefix = f"/{plugins_module.PACKAGE_MOUNT_PREFIX}/{plugin.id}/"
    if package is not None:
        return package.static_dir / url[len(prefix):] if url.startswith(prefix) else None
    return STATIC / url.lstrip("/") if url.startswith("/src/") or url.startswith("/foundation/") else None


def _imports_leaving_plugin(plugin, entry: Path) -> list[str]:
    """Relative and absolute imports that resolve outside the view's plugin and outside the core.

    The browser resolves an import against the URL of the module, so that is the space this check
    works in. That matters for a package: `../../src/shared/api/request.js` is how it reaches the
    core's fetch helper — allowed, and what phase 4 prescribes — while the same specifier shape can
    point at another plugin (`/src/plugins/llm-pool/api.js`), which is exactly the dependency the
    address rule forbids. Reading the resolved URL catches both; reading the specifier as a path
    catches neither.
    """
    found: list[str] = []
    seen: set[Path] = set()
    stack = [entry]
    while stack:
        current = stack.pop()
        if current in seen or not current.exists():
            continue
        seen.add(current)
        module_url = _url_of(plugin, current)
        allowed = (
            posixpath.dirname(module_url) + "/",
            _plugin_url_prefix(plugin),
            "/src/shared/",
            "/foundation/",
        )
        source = current.read_text(encoding="utf-8", errors="replace")
        for specifier in re.findall(r"""from\s*['"]([^'"]+)['"]""", source):
            if not specifier.startswith("."):
                decoded = specifier
            else:
                decoded = posixpath.join(posixpath.dirname(module_url), specifier)
            target_url = posixpath.normpath(unquote(decoded).replace("\\", "/"))
            if not any(target_url.startswith(prefix) for prefix in allowed):
                found.append(f"{current.name} imports {specifier}, which leaves the plugin")
                continue
            target = _file_of(plugin, target_url)
            if target is not None:
                stack.append(target)
    return found


def _missing_view_files() -> list[str]:
    """View modules and path icons that a plugin names but that are not there.

    A sprite id is checked against the sprite by the JS suite; a path icon is a file, and nothing
    else would notice a typo in it. The design asks for this check in phase 5, because a plugin
    from a package brings its own files.
    """
    missing: list[str] = []
    for plugin in all_plugins():
        for view in plugin.views:
            entry = _view_file(plugin, view)
            if not entry.exists():
                missing.append(f"view {view.route}: module {entry} does not exist")
            if "/" in view.icon and not _module_path(plugin, view.icon).exists():
                missing.append(f"view {view.route}: icon {view.icon} does not exist")
    return missing


class ViewFileTests(unittest.TestCase):
    """Every file a view names has to be there, for the registry and for a package alike."""

    def test_every_view_module_and_path_icon_exists(self) -> None:
        self.assertEqual(_missing_view_files(), [])

    def test_no_view_imports_outside_its_own_plugin(self) -> None:
        problems = [
            f"view {view.route}: {problem}"
            for plugin in all_plugins()
            for view in plugin.views
            for problem in _imports_leaving_plugin(plugin, _view_file(plugin, view))
        ]
        self.assertEqual(problems, [])


class ClientOwnershipTests(unittest.TestCase):
    """Which client a view may use.

    The point of phase 4: a view talks to its own plugin's client or to the core's, never to
    another plugin's. That is what keeps switching a category off from breaking a view elsewhere.
    """

    def test_no_view_imports_another_plugins_client(self) -> None:
        for plugin in all_plugins():
            for view in plugin.views:
                owners = _client_owners(_view_file(plugin, view))
                self.assertEqual(
                    owners - {plugin.id},
                    set(),
                    f"view {view.route} pulls in the client of {sorted(owners - {plugin.id})}",
                )

    def test_the_scan_finds_a_client_for_every_view_with_paths(self) -> None:
        """A check on the check: a view with endpoints must pull in a client module."""
        for plugin in all_plugins():
            for view in plugin.views:
                entry = _view_file(plugin, view)
                if _api_paths(entry):
                    self.assertTrue(
                        _client_owners(entry),
                        f"view {view.route} builds paths but imports no client",
                    )


class WebSocketTests(unittest.TestCase):
    """The two websockets are core routes too; they used to live outside the registry."""

    def test_the_two_expected_sockets_are_registered(self) -> None:
        self.assertEqual(
            _registered_sockets(),
            {"/ws/replay/{session_id}", "/ws/replay-speak/{session_id}"},
        )

    def test_every_socket_the_client_connects_to_is_registered(self) -> None:
        found = {
            path
            for plugin in all_plugins()
            for view in plugin.views
            for path in _socket_paths(_view_file(plugin, view))
        }
        self.assertTrue(found, "no websocket paths found in the views; the check would be empty")
        registered = _registered_sockets()
        for path in sorted(found):
            self.assertTrue(
                any(socket == path or socket.startswith(path) for socket in registered),
                f"the frontend connects to {path}, which the core does not serve",
            )


class PluginSwitchTests(unittest.TestCase):
    """`plugins.enabled` in settings decides which categories are in the menu.

    The registry stays a constant: settings say what is on, `app/plugins.py` says what exists, and
    `/plugins.js` is the two combined. Absent means everything is on, so a category added to the
    registry shows up by itself.
    """

    def test_the_shipped_settings_switch_nothing_off(self) -> None:
        """The committed default: every category in the menu, exactly as before this switch.

        Measured on a copy of the committed file with nothing beside it, so a machine that
        switched categories off in `config/local.json` does not turn this suite red.
        """
        committed = json.loads(SHIPPED_SETTINGS.read_text(encoding="utf-8"))
        self.assertIn("plugins", committed)
        self.assertNotIn("enabled", committed["plugins"])
        with _shipped_settings() as settings_path:
            self.assertEqual(enabled_plugins(settings_path), all_plugins())

    def test_only_the_named_categories_are_on(self) -> None:
        with _settings({"plugins": {"enabled": ["image-pool"]}}) as settings_path:
            self.assertEqual(
                [plugin.id for plugin in enabled_plugins(settings_path)],
                ["image-pool"],
            )

    def test_the_order_is_the_registry_order(self) -> None:
        """Listing ids in another order must not reorder the sidebar."""
        with _settings({"plugins": {"enabled": ["video-pool", "llm-pool"]}}) as settings_path:
            self.assertEqual(
                [plugin.id for plugin in enabled_plugins(settings_path)],
                ["llm-pool", "video-pool"],
            )

    def test_local_json_overrides_the_committed_settings(self) -> None:
        with _settings(
            {"plugins": {"enabled": ["llm-pool"]}},
            local={"plugins": {"enabled": ["image-pool"]}},
        ) as settings_path:
            self.assertEqual(
                [plugin.id for plugin in enabled_plugins(settings_path)],
                ["image-pool"],
            )

    def test_an_unknown_id_is_an_error(self) -> None:
        """A typo must not look like a working install that happens to miss one category."""
        with _settings({"plugins": {"enabled": ["image-pool", "imagepool"]}}) as settings_path:
            with self.assertRaises(ValueError) as raised:
                enabled_plugins(settings_path)
        self.assertIn("imagepool", str(raised.exception))

    def test_a_value_that_is_not_a_list_is_an_error(self) -> None:
        with _settings({"plugins": {"enabled": "image-pool"}}) as settings_path:
            with self.assertRaises(ValueError):
                enabled_plugins(settings_path)

    def test_an_empty_list_is_an_error(self) -> None:
        """An empty menu is not a workable state, so it fails loudly instead of showing an empty shell."""
        with _settings({"plugins": {"enabled": []}}) as settings_path:
            with self.assertRaises(ValueError) as raised:
                enabled_plugins(settings_path)
        self.assertIn("empty", str(raised.exception))

    def test_a_shape_error_above_enabled_is_an_error(self) -> None:
        """A `plugins` section of the wrong shape must not silently drop the list beside it.

        Left alone it is merged away, so the menu would show every category while the reader
        believes their switch was applied — the same failure the checks on `enabled` prevent.
        """
        with _settings(
            {"plugins": {"enabled": ["image-pool"]}},
            local={"plugins": "kapot"},
        ) as settings_path:
            with self.assertRaises(ValueError) as raised:
                enabled_plugins(settings_path)
        self.assertIn("local.json", str(raised.exception))

        with _settings({"plugins": "kapot"}) as settings_path:
            with self.assertRaises(ValueError) as raised:
                enabled_plugins(settings_path)
        self.assertIn("settings.json", str(raised.exception))

        with _settings(
            {"plugins": {"enabled": ["image-pool"]}},
            local={"plugins": [1, 2]},
        ) as settings_path:
            with self.assertRaises(ValueError) as raised:
                enabled_plugins(settings_path)
        self.assertIn("local.json", str(raised.exception))

    def test_a_settings_file_that_is_not_an_object_is_an_error(self) -> None:
        """A malformed settings file is not "no switch here": read that way it shows everything."""
        with _settings(
            {"plugins": {"enabled": ["image-pool"]}},
            local=["image-pool"],
        ) as settings_path:
            with self.assertRaises(ValueError) as raised:
                enabled_plugins(settings_path)
        self.assertIn("local.json", str(raised.exception))

    def test_a_settings_file_that_is_not_valid_json_names_itself(self) -> None:
        """A stray comma is the likeliest accident in a hand-edited `local.json`, and the decoder
        message says what is wrong and where, but not which of the two files it is in.
        """
        with _settings(
            {"plugins": {}},
            raw={"local.json": '{"plugins": {"enabled": ["image-pool"],}}'},
        ) as settings_path:
            with self.assertRaises(ValueError) as raised:
                enabled_plugins(settings_path)
        self.assertIn("local.json", str(raised.exception))
        self.assertIn("not valid JSON", str(raised.exception))

        with _settings({}, raw={"settings.json": '{"plugins": {,}}'}) as settings_path:
            with self.assertRaises(ValueError) as raised:
                enabled_plugins(settings_path)
        self.assertIn("settings.json", str(raised.exception))
        self.assertIn("not valid JSON", str(raised.exception))

    def test_a_null_plugins_section_counts_as_absent(self) -> None:
        """`plugins: null` claims nothing, so it is not a shape error. Pinned because the comment
        in `app/plugins.py` calls that a decision, and nothing else would notice if it changed.
        """
        with _settings(
            {"plugins": {"enabled": ["image-pool"]}},
            local={"plugins": None},
        ) as settings_path:
            self.assertEqual(enabled_plugins(settings_path), all_plugins())

        with _settings({"plugins": None}) as settings_path:
            self.assertEqual(enabled_plugins(settings_path), all_plugins())

    def test_an_explicit_null_turns_everything_on(self) -> None:
        """`enabled: null` is the one way `local.json` reverses the base file instead of narrowing
        it, and it follows from "no list means everything is on". Pinned so it stays a choice
        rather than an accident.
        """
        with _settings(
            {"plugins": {"enabled": ["image-pool"]}},
            local={"plugins": {"enabled": None}},
        ) as settings_path:
            self.assertEqual(enabled_plugins(settings_path), all_plugins())

    def test_the_route_answers_500_when_the_switch_is_wrong(self) -> None:
        """A typo must not serve a half-empty menu.

        `/plugins.js` raises, FastAPI answers 500, and `static/index.html`'s script tag leaves the
        global unset — so the browser shows its "plugin list did not arrive" panel instead of an
        empty sidebar. The browser half is checked in `tests/browser/check_plugin_registry.py`.

        A subprocess, because the route calls `frontend_script()`, whose default settings path was
        bound when `app.plugins` was imported.
        """
        with _settings({"plugins": {"enabled": ["imagepool"]}}) as settings_path:
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "from fastapi.testclient import TestClient; from app.main import app;"
                    " print(TestClient(app, raise_server_exceptions=False).get('/plugins.js').status_code)",
                ],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                env={**os.environ, "LLM_WORKBENCH_SETTINGS_FILE": str(settings_path)},
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "500", result.stderr)

    def test_the_error_names_the_file_the_switch_came_from(self) -> None:
        """`local.json` is the documented place to switch categories off, and it wins from the base
        file: a message about a typo in it must not send the reader to `settings.json`, where
        nothing is wrong.
        """
        with _settings({"plugins": {}}, local={"plugins": {"enabled": ["imagepool"]}}) as path:
            with self.assertRaises(ValueError) as raised:
                enabled_plugins(path)
        self.assertIn("local.json", str(raised.exception))
        self.assertNotIn("settings.json", str(raised.exception))

        with _settings({"plugins": {"enabled": ["imagepool"]}}) as path:
            with self.assertRaises(ValueError) as raised:
                enabled_plugins(path)
        self.assertIn("settings.json", str(raised.exception))

    def test_the_settings_file_can_be_pointed_elsewhere(self) -> None:
        """`LLM_WORKBENCH_SETTINGS_FILE` decides which file is read.

        That is how a deployment keeps its settings outside the repo, and how the browser check
        drives the workbench against the shipped defaults. A subprocess, because the path is
        resolved when `app.plugins` is imported.
        """
        with _settings({"plugins": {"enabled": ["llm-pool"]}}) as settings_path:
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "import json; from app.plugins import frontend_payload;"
                    " print(json.dumps([plugin['id'] for plugin in frontend_payload()]))",
                ],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                env={**os.environ, "LLM_WORKBENCH_SETTINGS_FILE": str(settings_path)},
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), ["llm-pool"])

    def test_the_generated_script_carries_only_the_enabled_categories(self) -> None:
        with _settings({"plugins": {"enabled": ["image-pool"]}}) as settings_path:
            body = frontend_script(settings_path)

        prefix = "window.__LLM_WORKBENCH_PLUGINS__ = "
        self.assertTrue(body.startswith(prefix), body[:60])
        payload = json.loads(body[len(prefix):].rstrip().rstrip(";"))
        self.assertEqual([entry["id"] for entry in payload], ["image-pool"])
        self.assertEqual(
            [view["route"] for view in payload[0]["views"]],
            ["image-pool-models", "image-generation", "image-lora-library", "image-train"],
        )


class DocumentedLineReferenceTests(unittest.TestCase):
    """Every file:line reference in the design document must still point at what it claims.

    Three review rounds in a row found stale line numbers in `docs/plugin-architecture.md`, each
    time because a code change in the same commit shifted them. Checking that by hand does not
    scale, so the document is read here instead: the referenced range has to contain the most
    specific symbol the surrounding prose names.

    What it does not catch, measured rather than assumed:

    - a shift inside the same symbol's span, for example from an ``if`` line to the call on the
      next line. A shift to unrelated code does fail.
    - a reference with a wide span: ``static/index.html:7-22`` covers a sixteen-line block, so
      roughly two thirds of the file's positions would still contain its anchor. The tightest
      references leave under 1%.
    - it reads prose with a heuristic, so it verifies that *a* symbol matches, not that the right
      one does. The anchor is the longest symbol the window names, which is what keeps a generic
      word like ``name`` from deciding — not the occurrence count the selection key looks like it
      uses.
    """

    def _references(self) -> list[tuple[int, str, int, int, str | None]]:
        """(doc line number, path, first line, last line, the symbol for a table row or None)."""
        found = []
        lines = ARCHITECTURE_DOC.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines, start=1):
            for match in DOC_REFERENCE.finditer(line):
                first = int(match.group(2))
                last = int(match.group(3)) if match.group(3) else first
                found.append((number, match.group(1), first, last, None))
            row = DOC_TABLE_ROW.match(line)
            if row:
                # The registry table names its file in the header, so the cells hold bare numbers.
                # The anchor is the symbol in that row: a window around a table row is its
                # neighbouring rows, which made all ten adjacent swaps pass.
                found.append((number, REGISTRY_RELATIVE, int(row.group(2)), int(row.group(2)), row.group(1)))
        return found

    def test_the_document_contains_references_to_check(self) -> None:
        """A check that silently finds nothing proves nothing."""
        self.assertGreaterEqual(len(self._references()), 12)

    def test_every_reference_resolves_to_the_symbol_it_names(self) -> None:
        lines = ARCHITECTURE_DOC.read_text(encoding="utf-8").splitlines()
        problems = []
        for number, path, first, last, row_symbol in self._references():
            target = REPO_ROOT / path
            if not target.exists():
                problems.append(f"line {number}: {path} does not exist")
                continue
            source = target.read_text(encoding="utf-8").splitlines()
            if last > len(source):
                problems.append(f"line {number}: {path}:{last} is past the end ({len(source)} lines)")
                continue
            anchors = self._anchors(lines, number, row_symbol, source)
            if not anchors:
                problems.append(
                    f"line {number}: the prose around {path}:{first} names no symbol that {path} contains"
                )
                continue
            # The anchor is the longest symbol the prose names. The key starts with
            # `source.count(candidate)`, but `source` is a list of lines, so that counts lines equal
            # to the candidate — always zero — and the length decides. A real occurrence count was
            # tried and rejected: it makes `debug` beat `buildViewError` as soon as one
            # console.debug disappears, failing a reference that is correct. Anchoring on the
            # symbol sitting on the reference's own line is the cleaner fix if this is revisited;
            # the reasoning is in docs/reviews/pr-16-plugin-registry-phase-2-review-findings-4.md.
            anchor = min(anchors, key=lambda candidate: (source.count(candidate), -len(candidate)))
            if anchor not in "\n".join(source[first - 1:last]):
                problems.append(
                    f"line {number}: {path}:{first}{'-' + str(last) if last != first else ''} "
                    f"does not mention {anchor!r}"
                )
        self.assertEqual(problems, [], "\n".join(problems))

    @staticmethod
    def _anchors(
        lines: list[str],
        number: int,
        row_symbol: str | None,
        source: list[str],
    ) -> set[str]:
        """Symbols the prose around a reference names, kept only if the file actually contains them.

        The window spans the line before and after, because a reference often ends a sentence whose
        subject sits on the previous line. Path-shaped tokens are dropped: they name a file, not a
        symbol, and the file is already part of the reference.
        """
        candidates: set[str] = set()
        if row_symbol:
            candidates.add(row_symbol)
        else:
            # The window spans the line before and after, because a reference often ends a sentence
            # whose subject sits on the previous line. Table rows are skipped unless they are the
            # reference's own line: a neighbour row names a different symbol, and a more specific
            # one at that, so it would decide the check.
            own = lines[number - 1] if 0 < number <= len(lines) else ""
            window = [own] + [
                line
                for line in lines[max(0, number - 2):number]
                if not line.startswith("|")
            ]
            for line in window:
                for token in DOC_TOKEN.findall(line):
                    token = token.strip().rstrip("()")
                    if len(token) < 3 or DOC_LINE_SUFFIX.search(token):
                        continue
                    if token.endswith((".js", ".py", ".html", ".css")):
                        continue
                    for candidate in (token, *token.split()):
                        candidate = candidate.strip(".,;:")
                        if len(candidate) >= 3:
                            candidates.add(candidate)
                            candidates.add(candidate.replace("/", "."))
        whole = "\n".join(source)
        return {candidate for candidate in candidates if candidate in whole}


class GeneratedScriptTests(unittest.TestCase):
    def test_plugins_js_is_served_and_revalidated(self) -> None:
        client = TestClient(app)

        response = client.get("/plugins.js")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/javascript")
        self.assertEqual(response.headers.get("cache-control"), "no-cache")

    def test_plugins_js_sets_the_global_the_frontend_reads(self) -> None:
        client = TestClient(app)

        body = client.get("/plugins.js").text
        prefix = "window.__LLM_WORKBENCH_PLUGINS__ = "
        self.assertTrue(body.startswith(prefix), body[:60])
        payload = json.loads(body[len(prefix):].rstrip().rstrip(";"))

        self.assertEqual(payload, frontend_payload())

    def test_index_loads_plugins_js_before_app_js(self) -> None:
        html = (STATIC / "index.html").read_text(encoding="utf-8")

        self.assertIn('<script src="plugins.js"></script>', html)
        self.assertLess(html.index("plugins.js"), html.index('src="app.js"'))


if __name__ == "__main__":
    unittest.main()
