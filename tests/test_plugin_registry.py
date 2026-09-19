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


def _called_paths(entry: Path, methods: dict[str, str]) -> tuple[set[str], set[str], set[str]]:
    """What a view's own code calls.

    Three things come back: the paths behind the ``api.<method>()`` calls, the hand-built
    ``/api/...`` literals, and any method name that could not be resolved. Views mostly go through
    the client, but six of them also build URLs by hand for downloads and streams — and those were
    invisible to this analysis until a review pointed out that an endpoint could be renamed to a
    path nobody serves without the suite noticing.

    Literals are returned as prefixes, because a hand-built URL is usually a base the view appends
    to; the ``${...}`` part of a template is cut off.
    """
    paths: set[str] = set()
    prefixes: set[str] = set()
    unknown: set[str] = set()
    for file in _module_files(entry):
        source = file.read_text(encoding="utf-8", errors="replace")
        for name in re.findall(r"\bapi\.([A-Za-z][A-Za-z0-9_]*)\(", source):
            if name in methods:
                paths.add(methods[name])
            else:
                unknown.add(name)
        for literal in LITERAL_API_PATH.findall(source):
            literal = literal[: literal.find("${")] if "${" in literal else literal
            literal = literal.rstrip("/")
            if len(literal) > len("/api/"):
                prefixes.add(literal)
    return paths, prefixes, unknown


def _prefix_is_served(prefix: str, app_paths: set[str]) -> bool:
    """A hand-built base URL is served when a route lives underneath it."""
    return any(
        candidate == prefix or candidate.startswith(prefix + "/") or candidate.startswith(prefix + "{")
        for candidate in app_paths
    )


def _router_paths(view) -> set[str]:
    return {"/api" + route.path for router in view.routers for route in router.routes}


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
            paths, prefixes, unknown = _called_paths(entry, methods)
            self.assertEqual(unknown, set(), f"view {view.route} calls unknown api methods")
            for path in sorted(paths):
                self.assertTrue(
                    _is_served(path, app_paths),
                    f"view {view.route} calls {path}, which no mounted route serves",
                )
            for prefix in sorted(prefixes):
                self.assertTrue(
                    _prefix_is_served(prefix, app_paths),
                    f"view {view.route} builds {prefix}/..., which no mounted route serves",
                )

    def test_the_literal_path_analysis_finds_something(self) -> None:
        """A check on the analysis itself: six views build URLs by hand."""
        methods = _client_method_paths()
        with_literals = [
            view.route
            for view in iter_views()
            if _called_paths(STATIC / view.module, methods)[1]
        ]
        self.assertGreaterEqual(len(with_literals), 4, f"only found literals in {with_literals}")

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
            paths, prefixes, _ = _called_paths(STATIC / view.module, methods)
            declared = _router_paths(view)
            for path in sorted(paths):
                self.assertTrue(
                    _is_served(path, declared),
                    f"view {view.route} calls {path}, which none of its declared routers serve",
                )
            for prefix in sorted(prefixes):
                self.assertTrue(
                    _prefix_is_served(prefix, declared),
                    f"view {view.route} builds {prefix}/..., which none of its declared routers serve",
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
            paths, prefixes, _ = _called_paths(STATIC / view.module, methods)
            for router in view.routers:
                router_paths = {"/api" + route.path for route in router.routes}
                self.assertTrue(
                    any(_is_served(path, router_paths) for path in paths)
                    or any(_prefix_is_served(prefix, router_paths) for prefix in prefixes),
                    f"view {view.route} declares a router whose endpoints it never calls",
                )

    def test_the_backend_less_view_calls_nothing(self) -> None:
        methods = _client_method_paths()
        for view in iter_views():
            if view.backend:
                continue
            paths, prefixes, _ = _called_paths(STATIC / view.module, methods)
            self.assertEqual(paths, set(), f"view {view.route} is marked backend-less but calls the API")
            self.assertEqual(prefixes, set(), f"view {view.route} is marked backend-less but builds URLs")

    def test_views_with_a_backend_reach_at_least_two_endpoints(self) -> None:
        """A smoke check on the analysis itself: if it finds nothing, it proves nothing."""
        methods = _client_method_paths()
        counts = {
            view.route: len(_called_paths(STATIC / view.module, methods)[0])
            + len(_called_paths(STATIC / view.module, methods)[1])
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
        """The mirror: a socket no view connects to should not be declared.

        The client class is named in the registry rather than derived from the path, so renaming a
        client class does not turn a correct declaration into a failure.
        """
        for view in iter_views():
            for socket in view.websockets:
                source = "\n".join(
                    file.read_text(encoding="utf-8", errors="replace")
                    for file in _module_files(STATIC / view.module)
                )
                self.assertIn(
                    socket.client,
                    source,
                    f"view {view.route} declares {socket.path} but never uses {socket.client}",
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
    - a reference with a wide span: ``static/index.html:7-22`` covers a sixteen-line block, so half
      the file's positions would still contain its anchor. The tightest references leave under 1%.
    - it reads prose with a heuristic, so it verifies that *a* symbol matches, not that the right
      one does. The most-specific rule is what keeps a generic word like ``name`` from deciding.
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
            # The most specific anchor carries the check: the symbol occurring least in the file.
            # Without this, a generic word like `name` decides, and a wide span around it matches
            # half the file.
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
