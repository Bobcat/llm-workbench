"""Tests for the plugin registry — the sidebar's source of truth.

Two kinds of test live here:

- the **regression pin**: a hand-written copy of the shipped sidebar. It is deliberately not
  derived from `app.plugins`, so that a mistake in the registry shows up here instead of being
  copied along. If you add or rename a view on purpose, update this table too.
- the **independent checks**: every view either has a backend or says it has none, and the
  endpoints the views actually call are served. Those do not read the registry's own claims.

The JS suite covers what only a browser can: that each view module resolves, exports its named
factory, and that every icon exists in the sprite.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.plugins import (
    PLUGINS,
    frontend_payload,
    iter_routers,
    iter_views,
    iter_websockets,
    route_aliases,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
STATIC = REPO_ROOT / "static"
API_CLIENT = STATIC / "src" / "api-client.js"

# The design document points at code by file and line. Those references are checked below, because
# three review rounds in a row found them stale after a code change shifted them.
ARCHITECTURE_DOC = REPO_ROOT / "docs" / "plugin-architecture.md"
REGISTRY_RELATIVE = "static/src/plugins/registry.js"
DOC_REFERENCE = re.compile(r"`([A-Za-z0-9_./-]+\.(?:js|py|html|css)):(\d+)(?:-(\d+))?`")
DOC_TABLE_ROW = re.compile(r"^\| `[A-Za-z_][A-Za-z0-9_]*` \| (\d+) \|")
DOC_TOKEN = re.compile(r"`([^`]+)`")
DOC_LINE_SUFFIX = re.compile(r":\d+")

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


def _module_files(entry: Path) -> set[Path]:
    """The view's own files: relative imports, stopping at the shared API client."""
    seen: set[Path] = set()
    stack = [entry]
    while stack:
        current = stack.pop()
        if current in seen or not current.exists():
            continue
        seen.add(current)
        source = current.read_text(encoding="utf-8", errors="replace")
        for specifier in re.findall(r"""from\s*['"](\.[^'"]+)['"]""", source):
            target = (current.parent / specifier).resolve()
            if target.name != "api-client.js":
                stack.append(target)
    return seen


def _api_object_source() -> str:
    """The `api` object only: the websocket classes below it are not API methods."""
    source = API_CLIENT.read_text(encoding="utf-8")
    start = source.index("export const api = {")
    end = source.index("\nexport class", start)
    return source[start:end]


def _client_method_paths() -> dict[str, str]:
    """method name -> the API path it calls, read out of static/src/api-client.js."""
    source = _api_object_source()
    starts = list(re.finditer(r"\n  (?:async )?([A-Za-z][A-Za-z0-9_]*)\([^)]*\)\s*\{", source))
    methods: dict[str, str] = {}
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(source)
        path = re.search(r"['\"`](/api/[^'\"`]*)['\"`]", source[match.end():end])
        if path:
            methods[match.group(1)] = path.group(1)
    return methods


def _called_paths(entry: Path, methods: dict[str, str]) -> tuple[set[str], set[str]]:
    """The API paths a view's own code calls, plus any method name we could not resolve."""
    paths: set[str] = set()
    unknown: set[str] = set()
    for file in _module_files(entry):
        source = file.read_text(encoding="utf-8", errors="replace")
        for name in re.findall(r"\bapi\.([A-Za-z][A-Za-z0-9_]*)\(", source):
            if name in methods:
                paths.add(methods[name])
            else:
                unknown.add(name)
    return paths, unknown


def _is_served(path: str, app_paths: set[str]) -> bool:
    """A literal path must match exactly; a path with a ${...} hole must match a route prefix."""
    literal = path.split("?", 1)[0]
    hole = literal.find("${")
    if hole == -1:
        return literal in app_paths
    prefix = literal[:hole].rstrip("/")
    return any(
        candidate == prefix or candidate.startswith(prefix + "/") or candidate.startswith(prefix + "{")
        for candidate in app_paths
    )


def _client_socket_paths() -> set[str]:
    """The websocket paths the frontend connects to, read out of static/src/api-client.js."""
    source = API_CLIENT.read_text(encoding="utf-8")
    return set(re.findall(r"/ws/[A-Za-z0-9/_-]*", source))


def _registered_sockets() -> set[str]:
    return {
        getattr(route, "path", "")
        for route in app.routes
        if route.__class__.__name__ == "APIWebSocketRoute"
    }


def _socket_class_name(path: str) -> str:
    """/ws/replay-speak/{session_id} -> ReplaySpeakWebSocket, the client class a view instantiates."""
    stem = path.removeprefix("/ws/").split("/")[0]
    return "".join(part.capitalize() for part in stem.split("-")) + "WebSocket"


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

    def test_aliases_do_not_shadow_a_route(self) -> None:
        routes = {view.route for view in iter_views()}
        for alias in route_aliases():
            self.assertNotIn(alias, routes, f"alias {alias} shadows a real route")

    def test_alias_targets_exist(self) -> None:
        routes = {view.route for view in iter_views()}
        for alias, target in route_aliases().items():
            self.assertIn(target, routes, f"alias {alias} points at a missing route {target}")

    def test_every_view_has_a_backend_or_says_it_has_none(self) -> None:
        for view in iter_views():
            if view.backend:
                self.assertTrue(view.routers, f"view {view.route} claims a backend but maps no router")
            else:
                self.assertFalse(view.routers, f"view {view.route} has routers but is marked backend-less")

    def test_every_router_is_mounted_exactly_once(self) -> None:
        routers = iter_routers()
        self.assertEqual(len({id(router) for router in routers}), len(routers))

        mounted = {"/api" + route.path for router in routers for route in router.routes}
        # Paths, not route objects: including a router builds new objects, and one path can carry
        # several methods or be registered by two views that share a router.
        self.assertEqual(mounted, _app_paths())

    def test_no_router_is_left_unmounted(self) -> None:
        from app.router import api_router

        mounted_prefixes = {
            getattr(route, "path", "").split("/{")[0]
            for route in api_router.routes
        }
        for router in iter_routers():
            for route in router.routes:
                expected = "/api" + route.path
                self.assertTrue(
                    any(expected == prefix or expected.startswith(prefix) for prefix in mounted_prefixes),
                    f"{expected} is not reachable from the mounted api router",
                )

    def test_payload_carries_no_routers(self) -> None:
        for plugin in frontend_payload():
            self.assertEqual(set(plugin), {"id", "label", "auxiliary", "views"})
            for view in plugin["views"]:
                # The exact key set, so a field that must not leak — websockets holds Python
                # callables, routers holds router objects — fails here instead of at json.dumps.
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


class ViewBackendTests(unittest.TestCase):
    """Independent of the registry: the endpoints a view calls must actually be served."""

    def test_every_api_method_has_a_resolvable_path(self) -> None:
        methods = _client_method_paths()
        source = _api_object_source()
        declared = set(re.findall(r"\n  (?:async )?([A-Za-z][A-Za-z0-9_]*)\([^)]*\)\s*\{", source))
        self.assertEqual(declared - set(methods), set(), "methods without a static /api path")

    def test_views_call_only_known_methods_and_served_paths(self) -> None:
        methods = _client_method_paths()
        app_paths = _app_paths()
        for view in iter_views():
            entry = STATIC / view.module
            paths, unknown = _called_paths(entry, methods)
            self.assertEqual(unknown, set(), f"view {view.route} calls unknown api methods")
            for path in sorted(paths):
                self.assertTrue(
                    _is_served(path, app_paths),
                    f"view {view.route} calls {path}, which no mounted route serves",
                )

    def test_declared_routers_cover_every_path_the_view_calls(self) -> None:
        """The per-view half: the routers a view declares must serve what that view calls.

        The check above only proves the union of every declared router covers every called path,
        which stays green when one view is mapped to the wrong router. This one is measured
        against the view's own declaration, so a swapped router fails here.
        """
        methods = _client_method_paths()
        for view in iter_views():
            if not view.backend:
                continue
            paths, _ = _called_paths(STATIC / view.module, methods)
            declared = {"/api" + route.path for router in view.routers for route in router.routes}
            for path in sorted(paths):
                self.assertTrue(
                    _is_served(path, declared),
                    f"view {view.route} calls {path}, which none of its declared routers serve",
                )

    def test_declared_routers_are_all_actually_used(self) -> None:
        """The mirror of the check above.

        A router a view never calls overstates what that view loses when its plugin is switched off,
        and phase 3 reads exactly that from this field. Measured clean when this was added.
        """
        methods = _client_method_paths()
        for view in iter_views():
            if not view.backend:
                continue
            paths, _ = _called_paths(STATIC / view.module, methods)
            for router in view.routers:
                router_paths = {"/api" + route.path for route in router.routes}
                self.assertTrue(
                    any(_is_served(path, router_paths) for path in paths),
                    f"view {view.route} declares a router whose endpoints it never calls",
                )

    def test_the_backend_less_view_calls_nothing(self) -> None:
        methods = _client_method_paths()
        for view in iter_views():
            if view.backend:
                continue
            paths, _ = _called_paths(STATIC / view.module, methods)
            self.assertEqual(paths, set(), f"view {view.route} is marked backend-less but calls the API")

    def test_views_with_a_backend_reach_at_least_two_endpoints(self) -> None:
        """A smoke check on the analysis itself: if it finds nothing, it proves nothing."""
        methods = _client_method_paths()
        counts = {
            view.route: len(_called_paths(STATIC / view.module, methods)[0])
            for view in iter_views()
            if view.backend
        }
        thin = {route: count for route, count in counts.items() if count < 2}
        self.assertEqual(thin, {})
        self.assertGreaterEqual(min(counts.values()), 2)


class WebSocketTests(unittest.TestCase):
    """The two websockets are routes too, and they used to live outside the registry."""

    def test_every_declared_socket_is_registered(self) -> None:
        self.assertEqual({socket.path for socket in iter_websockets()}, _registered_sockets())

    def test_every_socket_the_client_connects_to_is_declared(self) -> None:
        declared = {socket.path for socket in iter_websockets()}
        found = _client_socket_paths()
        self.assertTrue(found, "no websocket paths found in api-client.js; the check would be empty")
        for path in sorted(found):
            self.assertTrue(
                any(socket == path or socket.startswith(path) for socket in declared),
                f"the frontend connects to {path}, which no view declares",
            )

    def test_sockets_belong_to_a_view_that_has_a_backend(self) -> None:
        for view in iter_views():
            if not view.websockets:
                continue
            self.assertTrue(view.backend, f"view {view.route} has sockets but is marked backend-less")

    def test_the_registry_declares_the_expected_two_sockets(self) -> None:
        """A pin, not a wiring check: that every declared path is registered is the test above."""
        self.assertEqual(
            {socket.path for socket in iter_websockets()},
            {"/ws/replay/{session_id}", "/ws/replay-speak/{session_id}"},
        )

    def test_declared_sockets_are_actually_used(self) -> None:
        """The mirror: a socket no view connects to should not be declared."""
        for view in iter_views():
            for socket in view.websockets:
                name = _socket_class_name(socket.path)
                source = "\n".join(
                    file.read_text(encoding="utf-8", errors="replace")
                    for file in _module_files(STATIC / view.module)
                )
                self.assertIn(
                    name,
                    source,
                    f"view {view.route} declares {socket.path} but never uses {name}",
                )

class DocumentedLineReferenceTests(unittest.TestCase):
    """Every file:line reference in the design document must still point at what it claims.

    Three review rounds in a row found stale line numbers in `docs/plugin-architecture.md`, each
    time because a code change in the same commit shifted them. Checking that by hand does not
    scale, so the document is read here instead: the referenced range has to contain a symbol the
    surrounding prose names.

    What it does not catch: a shift that lands inside the same symbol's own span, for example from
    an ``if`` line to the call on the next line. A shift to unrelated code does fail.
    """

    def _references(self) -> list[tuple[int, str, int, int, str]]:
        """(doc line number, path, first line, last line, the doc line itself)."""
        found = []
        lines = ARCHITECTURE_DOC.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines, start=1):
            for match in DOC_REFERENCE.finditer(line):
                first = int(match.group(2))
                last = int(match.group(3)) if match.group(3) else first
                found.append((number, match.group(1), first, last, line))
            cell = DOC_TABLE_ROW.match(line)
            if cell:
                # The registry table names its file in the header, so the cells hold bare numbers.
                found.append((number, REGISTRY_RELATIVE, int(cell.group(1)), int(cell.group(1)), line))
        return found

    def test_the_document_contains_references_to_check(self) -> None:
        """A check that silently finds nothing proves nothing."""
        self.assertGreaterEqual(len(self._references()), 12)

    def test_every_reference_resolves_to_the_symbol_it_names(self) -> None:
        lines = ARCHITECTURE_DOC.read_text(encoding="utf-8").splitlines()
        problems = []
        for number, path, first, last, _doc_line in self._references():
            target = REPO_ROOT / path
            if not target.exists():
                problems.append(f"line {number}: {path} does not exist")
                continue
            source = target.read_text(encoding="utf-8").splitlines()
            if last > len(source):
                problems.append(f"line {number}: {path}:{last} is past the end ({len(source)} lines)")
                continue
            anchors = self._anchors(lines, number)
            if not anchors:
                continue
            window = "\n".join(source[first - 1:last])
            if any(anchor in window for anchor in anchors):
                continue
            problems.append(
                f"line {number}: {path}:{first}{'-' + str(last) if last != first else ''} "
                f"mentions none of {sorted(anchors)}"
            )
        self.assertEqual(problems, [], "\n".join(problems))

    @staticmethod
    def _anchors(lines: list[str], number: int) -> set[str]:
        """Symbols the prose around a reference names, used as anchors to check it against.

        The window spans the line before and after, because a reference often ends a sentence whose
        subject sits on the previous line. Path-shaped tokens are dropped: they name a file, not a
        symbol, and the file is already part of the reference.
        """
        anchors: set[str] = set()
        for line in lines[max(0, number - 2):number + 1]:
            for token in DOC_TOKEN.findall(line):
                token = token.strip().rstrip("()")
                if len(token) < 3 or DOC_LINE_SUFFIX.search(token):
                    continue
                if token.endswith((".js", ".py", ".html", ".css")):
                    continue
                for candidate in (token, *token.split()):
                    candidate = candidate.strip(".,;:")
                    if len(candidate) < 3:
                        continue
                    anchors.add(candidate)
                    anchors.add(candidate.replace("/", "."))
        return anchors


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
