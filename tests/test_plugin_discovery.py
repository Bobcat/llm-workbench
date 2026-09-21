"""Tests for plugin discovery — a plugin that lives in its own package.

Two kinds of test live here:

- **in-process**: a synthetic `PluginPackage` is patched into the registry, which is enough for the
  payload, the switch, the validation and the analyses; no mounting is involved.
- **end-to-end**: a fabricated package with real entry-point metadata on `PYTHONPATH`, in a
  subprocess, because the mounts and the route table are built when `app.main` is imported. That is
  the only place where "the core serves a package's files and addresses" can be measured.

The design and the decisions behind it are in `docs/plugin-architecture.md`, phase 5.
"""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
import unittest.mock
from pathlib import Path

from fastapi import APIRouter

from app import plugins as plugins_module
from app.plugins import Plugin, PluginPackage, View

REPO_ROOT = Path(__file__).resolve().parent.parent

FAKE_MODULE = '''\
"""A plugin package, fabricated by the test suite."""
from pathlib import Path

from fastapi import APIRouter

from app.plugins import Plugin, PluginPackage, View

router = APIRouter(prefix="/fake", tags=["fake"])


@router.get("/ping")
def ping() -> dict[str, str]:
    return {{"status": "ok"}}


def build() -> PluginPackage:
    here = Path(__file__).parent
    return PluginPackage(
        plugin=Plugin(
            id={plugin_id!r},
            label="Fake plugin",
            styles=("plugin-static/{plugin_id}/plugin.css",),
            views=(
                View(
                    id="{plugin_id}-view",
                    route="{plugin_id}-view",
                    name="Fake view",
                    icon="plugin-static/{plugin_id}/icon.svg",
                    module="plugin-static/{plugin_id}/view.js",
                    factory="createFakeView",
                ),
            ),
        ),
        static_dir=here / "static",
        routers=(router,),
    )
'''


@contextlib.contextmanager
def _fake_package(
    plugin_id: str = "fake",
    *,
    static_dir: Path | None = None,
    module: str | None = None,
    routes: tuple[str, ...] | None = None,
    plugin: Plugin | None = None,
):
    """A `PluginPackage` for the in-process tests, built in a temporary directory."""
    with tempfile.TemporaryDirectory() as tmp:
        root = static_dir or (Path(tmp) / "static")
        root.mkdir(parents=True, exist_ok=True)
        (root / "api.js").write_text(
            "export const api = {\n"
            "  async getThings() { return fetchJson('/api/fake/things'); }\n"
            "};\n",
            encoding="utf-8",
        )
        (root / "view.js").write_text("import { api } from './api.js';\n", encoding="utf-8")
        (root / "icon.svg").write_text("<svg></svg>\n", encoding="utf-8")
        views = tuple(
            View(
                id=f"{plugin_id}-{route}",
                route=route,
                name=route,
                icon=f"plugin-static/{plugin_id}/icon.svg",
                module=module or f"plugin-static/{plugin_id}/view.js",
                factory="createFakeView",
            )
            for route in (routes or (f"{plugin_id}-view",))
        )
        package = PluginPackage(
            plugin=plugin
            or Plugin(id=plugin_id, label="Fake plugin", views=views, styles=(f"plugin-static/{plugin_id}/plugin.css",)),
            static_dir=root,
        )
        yield package


@contextlib.contextmanager
def _discovered(*packages: PluginPackage):
    """Let discovery find exactly these packages, through the real code path.

    The fake entry points go through `_discover_packages`, so the validation and the collision
    checks run for real instead of being patched around.
    """
    points = []
    for index, package in enumerate(packages):
        point = unittest.mock.Mock()
        point.name = f"fake{index}"
        point.value = f"{package.plugin.id}_plugin:build"
        point.load.return_value = (lambda package=package: package)
        points.append(point)
    with unittest.mock.patch.object(plugins_module, "entry_points", return_value=points):
        with unittest.mock.patch.object(plugins_module, "_DISCOVERED", None):
            yield


class DiscoveryPayloadTests(unittest.TestCase):
    """What discovery adds to the menu, and what the switch does with it."""

    def test_a_discovered_plugin_appears_after_the_built_in_ones(self) -> None:
        with _fake_package("zzz-last") as last, _fake_package("aaa-first") as first:
            with _discovered(last, first):
                payload = plugins_module.frontend_payload()
                built_in = [plugin.id for plugin in plugins_module.PLUGINS]

                self.assertEqual([entry["id"] for entry in payload[:8]], built_in)
                # Binnen het gevonden deel wordt op id gesorteerd: de landingsroute is de eerste view.
                self.assertEqual([entry["id"] for entry in payload[8:]], ["aaa-first", "zzz-last"])
                discovered = payload[8]
                self.assertEqual(discovered["label"], "Fake plugin")
                self.assertEqual(discovered["styles"], ["plugin-static/aaa-first/plugin.css"])
                self.assertEqual(discovered["views"][0]["module"], "plugin-static/aaa-first/view.js")

    def test_the_switch_filters_discovered_plugins_too(self) -> None:
        with _fake_package("fake") as package:
            with _discovered(package):
                with tempfile.TemporaryDirectory() as tmp:
                    settings = Path(tmp) / "settings.json"
                    settings.write_text(json.dumps({"plugins": {"enabled": ["fake"]}}), encoding="utf-8")
                    enabled = plugins_module.enabled_plugins(settings)
        self.assertEqual([plugin.id for plugin in enabled], ["fake"])

    def test_an_unknown_id_is_still_an_error(self) -> None:
        with _fake_package("fake") as package:
            with _discovered(package):
                with tempfile.TemporaryDirectory() as tmp:
                    settings = Path(tmp) / "settings.json"
                    settings.write_text(json.dumps({"plugins": {"enabled": ["fak"]}}), encoding="utf-8")
                    with self.assertRaises(ValueError) as raised:
                        plugins_module.enabled_plugins(settings)
        self.assertIn("fak", str(raised.exception))


class DiscoveryValidationTests(unittest.TestCase):
    """Everything a package can get wrong, refused at load with the plugin or entry point named."""

    def test_a_missing_static_dir_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            package = PluginPackage(
                plugin=Plugin(
                    id="fake",
                    label="Fake",
                    views=(View(id="v", route="fake-view", name="v", icon="x", module="plugin-static/fake/v.js", factory="f"),),
                ),
                static_dir=Path(tmp) / "bestaat-niet",
            )
            with _discovered(package):
                with self.assertRaises(ValueError) as raised:
                    plugins_module.discovered_packages()
        self.assertIn("fake", str(raised.exception))
        self.assertIn("static_dir", str(raised.exception))

    def test_a_view_outside_the_plugins_own_mount_is_refused(self) -> None:
        with _fake_package("fake", module="src/workflows/elsewhere/index.js") as package:
            with _discovered(package):
                with self.assertRaises(ValueError) as raised:
                    plugins_module.discovered_packages()
        self.assertIn("plugin-static/fake/", str(raised.exception))

    def test_an_icon_outside_the_plugins_own_mount_is_refused(self) -> None:
        with _fake_package("fake") as package:
            view = package.plugin.views[0]
            stray = Plugin(
                id=package.plugin.id,
                label=package.plugin.label,
                views=(View(**{**view.__dict__, "icon": "plugin-static/andere/icon.svg"}),),
                styles=package.plugin.styles,
            )
            with _discovered(PluginPackage(plugin=stray, static_dir=package.static_dir)):
                with self.assertRaises(ValueError) as raised:
                    plugins_module.discovered_packages()
        self.assertIn("icon", str(raised.exception))

    def test_a_sprite_icon_id_is_still_allowed(self) -> None:
        with _fake_package("fake") as package:
            view = package.plugin.views[0]
            sprite = Plugin(
                id=package.plugin.id,
                label=package.plugin.label,
                views=(View(**{**view.__dict__, "icon": "languages"}),),
                styles=package.plugin.styles,
            )
            with _discovered(PluginPackage(plugin=sprite, static_dir=package.static_dir)):
                self.assertEqual([item.plugin.id for item in plugins_module.discovered_packages()], ["fake"])

    def test_a_duplicate_plugin_id_is_refused(self) -> None:
        with _fake_package("image-pool") as package:
            with _discovered(package):
                with self.assertRaises(ValueError) as raised:
                    plugins_module.discovered_packages()
        self.assertIn("image-pool", str(raised.exception))

    def test_a_duplicate_route_is_refused(self) -> None:
        with _fake_package("fake", routes=("chat",)) as package:
            with _discovered(package):
                with self.assertRaises(ValueError) as raised:
                    plugins_module.discovered_packages()
        message = str(raised.exception)
        self.assertIn("chat", message)
        self.assertIn("llm-pool", message)

    def test_a_factory_that_raises_is_refused_with_the_entry_point(self) -> None:
        broken = unittest.mock.Mock()
        broken.name = "broken"
        broken.value = "broken_package:build"
        broken.load.side_effect = RuntimeError("kapot bij import")
        with unittest.mock.patch.object(plugins_module, "entry_points", return_value=[broken]):
            with unittest.mock.patch.object(plugins_module, "_DISCOVERED", None):
                with self.assertRaises(ValueError) as raised:
                    plugins_module.discovered_packages()
        message = str(raised.exception)
        self.assertIn("broken_package:build", message)
        self.assertIn("kapot bij import", message)

    def test_an_entry_point_that_returns_something_else_is_refused(self) -> None:
        wrong = unittest.mock.Mock()
        wrong.name = "wrong"
        wrong.value = "wrong_package:build"
        wrong.load.return_value = lambda: {"not": "a package"}
        with unittest.mock.patch.object(plugins_module, "entry_points", return_value=[wrong]):
            with unittest.mock.patch.object(plugins_module, "_DISCOVERED", None):
                with self.assertRaises(ValueError) as raised:
                    plugins_module.discovered_packages()
        self.assertIn("PluginPackage", str(raised.exception))


class PackageAnalysisTests(unittest.TestCase):
    """The analyses must work for a package, which was the review's main worry."""

    def test_paths_and_ownership_follow_the_package_root(self) -> None:
        import importlib.util

        spec = importlib.util.spec_from_file_location("tpr", REPO_ROOT / "tests" / "test_plugin_registry.py")
        tpr = importlib.util.module_from_spec(spec)
        sys.modules["tpr"] = tpr
        spec.loader.exec_module(tpr)

        with _fake_package("fake") as package:
            with _discovered(package):
                entry = tpr._view_file(package.plugin, package.plugin.views[0])

                self.assertTrue(entry.exists(), entry)
                self.assertEqual(tpr._api_paths(entry), {"/api/fake/things"})
                self.assertEqual(tpr._client_owners(entry), {"fake"})


class EndToEndDiscoveryTests(unittest.TestCase):
    """A package that is really installed: entry-point metadata on `PYTHONPATH`, mounts and all.

    A subprocess, because `app/main.py` and `app/router.py` build the mounts and the route table
    when they are imported; patching discovery afterwards cannot change what was already mounted.
    """

    def _write_package(self, root: Path, plugin_id: str) -> None:
        package_dir = root / f"{plugin_id}_plugin"
        (package_dir / "static").mkdir(parents=True)
        (package_dir / "__init__.py").write_text(
            textwrap.dedent(FAKE_MODULE.format(plugin_id=plugin_id)), encoding="utf-8",
        )
        (package_dir / "static" / "view.js").write_text("export const x = 1;\n", encoding="utf-8")
        (package_dir / "static" / "icon.svg").write_text("<svg></svg>\n", encoding="utf-8")
        (package_dir / "static" / "plugin.css").write_text(".fake {}\n", encoding="utf-8")
        dist_info = root / f"{plugin_id}_plugin-1.0.dist-info"
        dist_info.mkdir()
        (dist_info / "METADATA").write_text(
            "Metadata-Version: 2.1\n"
            f"Name: {plugin_id}-plugin\n"
            "Version: 1.0\n",
            encoding="utf-8",
        )
        (dist_info / "entry_points.txt").write_text(
            "[llm_workbench.plugins]\n"
            f"{plugin_id} = {plugin_id}_plugin:build\n",
            encoding="utf-8",
        )

    def test_a_real_package_is_discovered_served_and_mounted(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._write_package(root, "fake")
            script = textwrap.dedent(
                """
                import json
                from fastapi.testclient import TestClient
                from app.main import app

                client = TestClient(app)
                served = client.get("/plugin-static/fake/view.js")
                unknown = client.get("/plugin-static/fake/bestaat-niet.js")
                api_call = client.get("/api/fake/ping")
                body = client.get("/plugins.js").text
                payload = json.loads(body.split(" = ", 1)[1].rstrip().rstrip(";"))
                print(json.dumps({
                    "ids": [entry["id"] for entry in payload],
                    "styles": payload[-1]["styles"],
                    "module": payload[-1]["views"][0]["module"],
                    "served": served.status_code,
                    "cache": served.headers.get("cache-control"),
                    "unknown": unknown.status_code,
                    "api": api_call.status_code,
                    "api_body": api_call.json(),
                }))
                """
            )
            result = subprocess.run(
                [sys.executable, "-c", script],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONPATH": os.pathsep.join([str(root), str(REPO_ROOT)])},
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        found = json.loads(result.stdout.strip().splitlines()[-1])

        self.assertEqual(found["ids"][-1], "fake")
        self.assertEqual(found["styles"], ["plugin-static/fake/plugin.css"])
        self.assertEqual(found["module"], "plugin-static/fake/view.js")
        self.assertEqual(found["served"], 200)
        self.assertEqual(found["cache"], "no-cache")
        self.assertEqual(found["unknown"], 404)
        self.assertEqual(found["api"], 200)
        self.assertEqual(found["api_body"], {"status": "ok"})

    def test_without_packages_the_menu_is_the_registry(self) -> None:
        """The other half of the promise: no entry points means no change at all."""
        script = textwrap.dedent(
            """
            import json
            from app.plugins import all_plugins, frontend_payload
            print(json.dumps({
                "payload": [entry["id"] for entry in frontend_payload()],
                "all": [plugin.id for plugin in all_plugins()],
            }))
            """
        )
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        found = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(found["payload"], found["all"])
        self.assertEqual(len(found["all"]), 8)


if __name__ == "__main__":
    unittest.main()
