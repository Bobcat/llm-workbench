#!/usr/bin/env python
"""End-to-end check for the frontend plugin registry.

Not a pytest test: it needs a running server and a Chromium build, so it is a script you run
deliberately. It starts the workbench itself on a free port, drives it with Playwright, and
stops the server again. It runs that server against the shipped `config/settings.json`, through
`LLM_WORKBENCH_SETTINGS_FILE`, so a machine that switched categories off in `config/local.json`
does not hide the routes this check walks.

    ./.venv/bin/python tests/browser/check_plugin_registry.py

Requires the workbench venv (uvicorn) and playwright with chromium installed. Exits non-zero
and prints every problem it found.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]

EXPECTED_CATEGORIES = [
    "Realtime Translation",
    "Realtime TTS",
    "LLM Pool",
    "TTS Pool",
    "Image Pool",
    "Video Pool",
    "Translation Services",
]
EXPECTED_ROUTES = [
    "replay-translate", "replay-speak",
    "llm-pool-models", "text-generation", "chat",
    "tts-pool-models",
    "image-pool-models", "image-generation", "image-lora-library", "image-train",
    "video-pool-models", "video-generation",
    "image-translation", "image-translation-regression", "pdf-translation",
    "pdf-translation-regression", "pdf-testing", "pdf-anatomy", "prompt-library",
    "icons",
]
ALIASES = {
    "ad-hoc-prompt": "text-generation",
    "vlm-test": "text-generation",
    "translation-requests": "image-translation",
    "translation-regression": "image-translation-regression",
}
PDF_TESTING_MODULE = "**/src/workflows/pdf-testing/index.js*"


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_server(port: int, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.5)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.1)
    raise RuntimeError(f"workbench did not start on port {port}")


class Checks:
    def __init__(self) -> None:
        self.problems: list[str] = []

    def check(self, condition: bool, message: str) -> None:
        if not condition:
            self.problems.append(message)

    def note(self, message: str) -> None:
        print(message)


def verify(base: str, checks: Checks) -> None:
    problems = checks.problems
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page_errors: list[str] = []
        import_failures: list[str] = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        def on_console(message) -> None:
            if message.type == "error" and (
                "dynamically imported module" in message.text or "Failed to fetch" in message.text
            ):
                import_failures.append(message.text)

        page.on("console", on_console)

        # --- deep link straight into a non-default route ---
        page.goto(f"{base}/#pdf-testing")
        page.wait_for_selector("#appRoot > *", timeout=10000)
        active = page.get_attribute('li[data-route="pdf-testing"]', "class") or ""
        checks.check("active" in active, "deep link #pdf-testing did not activate its sidebar item")

        # --- sidebar structure ---
        labels = page.eval_on_selector_all(
            "#workflowList .sidebar-section-label", "els => els.map(e => e.textContent.trim())"
        )
        checks.check(labels == EXPECTED_CATEGORIES, f"categories mismatch: {labels}")
        routes = page.eval_on_selector_all(
            "#workflowList li[data-route]", "els => els.map(e => e.dataset.route)"
        )
        checks.check(routes == EXPECTED_ROUTES, f"sidebar routes mismatch: {routes}")
        auxiliary = page.eval_on_selector_all(
            "#workflowList li.sidebar-route-bottom", "els => els.map(e => e.dataset.route)"
        )
        checks.check(auxiliary == ["icons"], f"auxiliary items mismatch: {auxiliary}")
        tooltips = page.eval_on_selector_all(
            '#workflowList li[data-route="llm-pool-models"]', "els => els.map(e => e.dataset.tooltip)"
        )
        checks.check(tooltips == ["LLM pool models"], f"tooltip mismatch: {tooltips}")

        # --- every route mounts and marks itself active ---
        for route in EXPECTED_ROUTES:
            page.click(f'li[data-route="{route}"] span.link-text')
            page.wait_for_selector("#appRoot > *", timeout=10000)
            cls = page.get_attribute(f'li[data-route="{route}"]', "class") or ""
            checks.check("active" in cls, f"route {route}: sidebar item not marked active")
        mounted = page.eval_on_selector_all("#appRoot > *", "els => els.length")
        checks.check(mounted == 1, f"appRoot holds {mounted} views instead of 1")

        # --- aliases resolve to the real route without rewriting the url ---
        for alias, target in ALIASES.items():
            page.goto(f"{base}/#{alias}")
            page.wait_for_selector("#appRoot > *", timeout=10000)
            cls = page.get_attribute(f'li[data-route="{target}"]', "class") or ""
            checks.check("active" in cls, f"alias #{alias} did not activate {target}")
            checks.check(page.url.endswith(f"#{alias}"), f"alias #{alias} rewrote the url")

        # --- persistent views keep their DOM, non-persistent ones do not ---
        page.click('li[data-route="llm-pool-models"] span.link-text')
        page.wait_for_selector("#appRoot > *", timeout=10000)
        page.eval_on_selector("#appRoot > *", "el => { el.dataset.probe = 'kept'; }")
        page.click('li[data-route="chat"] span.link-text')
        page.wait_for_selector("#appRoot > *", timeout=10000)
        page.click('li[data-route="llm-pool-models"] span.link-text')
        page.wait_for_selector("#appRoot > *", timeout=10000)
        kept = page.eval_on_selector("#appRoot > *", "el => el.dataset.probe || ''")
        checks.check(kept == "kept", "persistent view lost its DOM on re-entry")

        page.click('li[data-route="icons"] span.link-text')
        page.wait_for_selector("#appRoot > *", timeout=10000)
        page.eval_on_selector("#appRoot > *", "el => { el.dataset.probe = 'transient'; }")
        page.click('li[data-route="chat"] span.link-text')
        page.wait_for_selector("#appRoot > *", timeout=10000)
        page.click('li[data-route="icons"] span.link-text')
        page.wait_for_selector("#appRoot > *", timeout=10000)
        transient = page.eval_on_selector("#appRoot > *", "el => el.dataset.probe || ''")
        checks.check(transient == "", "non-persistent view was unexpectedly cached")

        # --- theme toggle ---
        before = page.evaluate("document.documentElement.dataset.theme")
        page.click("#themeToggle")
        after = page.evaluate("document.documentElement.dataset.theme")
        checks.check(before != after, "theme toggle did not change the theme")

        # --- a cold view shows a placeholder while its module is in flight ---
        held: dict = {}
        holder = browser.new_page()
        holder.route(PDF_TESTING_MODULE, lambda route: held.setdefault("route", route))
        holder.goto(f"{base}/#pdf-testing")
        try:
            holder.wait_for_selector(".workflow-loading", timeout=5000)
            placeholder = holder.inner_text(".workflow-loading")
            checks.check("PDF benchmark" in placeholder, f"placeholder text: {placeholder!r}")
        except Exception as error:  # noqa: BLE001 - reported as a problem
            problems.append(f"no loading placeholder while the module was held: {error}")
        if "route" not in held:
            problems.append("module request was never intercepted")
        else:
            held["route"].continue_()
            holder.wait_for_selector(".workflow-loading", state="detached", timeout=10000)
            holder.wait_for_selector("#appRoot > *", timeout=10000)
            checks.check(
                holder.query_selector(".workflow-error") is None,
                "view errored after the held module was released",
            )
        holder.close()
        checks.note("placeholder: shown while the module was held, then the view mounted")

        # --- a module that cannot be fetched renders a visible error ---
        broken = browser.new_page()
        broken.route(PDF_TESTING_MODULE, lambda route: route.abort())
        broken.goto(f"{base}/#pdf-testing")
        try:
            broken.wait_for_selector(".workflow-error", timeout=5000)
            text = broken.inner_text(".workflow-error")
            checks.check("PDF benchmark" in text, f"error panel does not name the view: {text!r}")
            checks.check(
                "src/workflows/pdf-testing/index.js" in text,
                f"error panel does not name the module: {text!r}",
            )
            checks.check(
                broken.eval_on_selector_all("#appRoot > *", "els => els.length") == 1,
                "the error panel is not the only thing mounted in the host",
            )
        except Exception as error:  # noqa: BLE001 - reported as a problem
            problems.append(f"broken module did not render a visible error: {error}")
        broken.close()
        checks.note("error panel: shown for a module that cannot be fetched")

        # --- a failed load is retried on the next activation with a fresh url ---
        retry = browser.new_page()
        attempts: list[str] = []

        def fail_first(route) -> None:
            attempts.append(route.request.url)
            if len(attempts) == 1:
                route.abort()
            else:
                route.continue_()

        retry.route(PDF_TESTING_MODULE, fail_first)
        retry.goto(f"{base}/#pdf-testing")
        try:
            retry.wait_for_selector(".workflow-error", timeout=5000)
            retry.click('li[data-route="chat"] span.link-text')
            retry.wait_for_selector("#appRoot > *", timeout=10000)
            retry.click('li[data-route="pdf-testing"] span.link-text')
            retry.wait_for_selector(".workflow-loading", state="detached", timeout=10000)
            retry.wait_for_selector("#appRoot > *", timeout=10000)
            checks.check(
                retry.query_selector(".workflow-error") is None,
                "retry after a failed load still shows the error panel",
            )
            checks.check(len(attempts) == 2, f"expected 2 module requests, saw {len(attempts)}")
            if len(attempts) == 2:
                checks.check(
                    "retry=1" in attempts[1],
                    f"retry did not use a fresh url: {attempts[1]}",
                )
        except Exception as error:  # noqa: BLE001 - reported as a problem
            problems.append(f"retry after a failed load failed: {error}")
        retry.close()
        checks.note(f"retry: {len(attempts)} module requests, second is a fresh url")

        # --- a module that loads but exports no factory is not retried ---
        # The module arrives fine; only the manifest is wrong. A fresh URL cannot fix that, so
        # repeat visits must not keep fetching.
        stub = browser.new_page()
        stub_urls: list[str] = []

        def serve_stub(route) -> None:
            stub_urls.append(route.request.url)
            route.fulfill(status=200, content_type="text/javascript", body="export const nothing = 1;")

        stub.route(PDF_TESTING_MODULE, serve_stub)
        stub.goto(f"{base}/#pdf-testing")
        try:
            stub.wait_for_selector(".workflow-error", timeout=5000)
            for _ in range(2):
                stub.click('li[data-route="chat"] span.link-text')
                stub.wait_for_selector("#appRoot > *", timeout=10000)
                stub.click('li[data-route="pdf-testing"] span.link-text')
                stub.wait_for_selector(".workflow-error", timeout=10000)
            checks.check(
                len(stub_urls) == 1,
                f"a deterministic manifest error refetched the module: {stub_urls}",
            )
        except Exception as error:  # noqa: BLE001 - reported as a problem
            problems.append(f"missing-factory case behaved unexpectedly: {error}")
        stub.close()
        checks.note(f"missing factory: {len(stub_urls)} module request(s) across three visits")

        # --- away-and-back during a cold load is normal, not an error ---
        raced = browser.new_page()
        held_again: dict = {}
        loader_errors: list[str] = []

        def collect_loader_errors(message) -> None:
            if message.type == "error" and (
                "discarded a view" in message.text or "view load failed after navigation" in message.text
            ):
                loader_errors.append(message.text)

        raced.on("console", collect_loader_errors)
        raced.route(PDF_TESTING_MODULE, lambda route: held_again.setdefault("route", route))
        try:
            raced.goto(f"{base}/#pdf-testing")
            raced.wait_for_selector(".workflow-loading", timeout=5000)
            raced.click('li[data-route="chat"] span.link-text')
            raced.wait_for_selector("#appRoot > *", timeout=10000)
            raced.click('li[data-route="pdf-testing"] span.link-text')
            if "route" not in held_again:
                problems.append("race: module request was never intercepted")
            else:
                held_again["route"].continue_()
            raced.wait_for_selector(".workflow-loading", state="detached", timeout=10000)
            raced.wait_for_selector("#appRoot > *", timeout=10000)
            checks.check(raced.query_selector(".workflow-error") is None, "race: error panel after away-and-back")
            checks.check(
                raced.eval_on_selector_all("#appRoot > *", "els => els.length") == 1,
                "race: host does not hold exactly one view",
            )
            checks.check(
                not loader_errors,
                f"a discarded view was logged at error level: {loader_errors}",
            )
        except Exception as error:  # noqa: BLE001 - reported as a problem
            problems.append(f"race away-and-back failed: {error}")
        raced.close()
        checks.note("race: away-and-back mounts one view and logs nothing at error level")

        # --- the sidebar busy indicator runs through the shared event for every view ---
        # The shell used to special-case the replay view with an event of its own; this pins the
        # generic path that replaced it, and that the retired event no longer does anything.
        busy = browser.new_page()
        busy.goto(f"{base}/#replay-translate")
        busy.wait_for_selector("#appRoot > *", timeout=10000)

        def dispatch(name: str, detail: dict) -> None:
            busy.evaluate(
                "([name, detail]) => window.dispatchEvent(new CustomEvent(name, { detail }))",
                [name, detail],
            )

        dispatch("llm-workbench:workflow-busy", {"workflow": "replay-translate", "busy": True})
        marked = busy.get_attribute('li[data-route="replay-translate"]', "class") or ""
        checks.check("is-running" in marked, "busy event did not mark the replay sidebar item")

        dispatch("llm-workbench:workflow-busy", {"workflow": "replay-translate", "busy": False})
        cleared = busy.get_attribute('li[data-route="replay-translate"]', "class") or ""
        checks.check("is-running" not in cleared, "busy event did not clear the replay sidebar item")

        dispatch("llm-workbench:replay-status", {"status": "playing"})
        legacy = busy.get_attribute('li[data-route="replay-translate"]', "class") or ""
        checks.check(
            "is-running" not in legacy,
            "the retired replay-status event still marks the sidebar item",
        )

        # The shell half above is synthetic. This is the view half: drive the replay view's own
        # status function and watch what it publishes. Without this, reverting the line that
        # replaced the retired event would leave the suite green.
        view_half = busy.evaluate("""
          async () => {
            const emitted = [];
            const retired = [];
            const onBusy = (event) => emitted.push(event.detail);
            const onRetired = () => retired.push(1);
            window.addEventListener('llm-workbench:workflow-busy', onBusy);
            window.addEventListener('llm-workbench:replay-status', onRetired);
            const { setStatusBadge } = await import('/src/workflows/replay/ui.js');
            const itemClass = () =>
              document.querySelector('li[data-route="replay-translate"]').className;

            const container = document.createElement('div');
            const badge = document.createElement('span');
            badge.id = 'replayStatusBadge';
            container.append(badge);

            setStatusBadge(container, 'playing');
            const marked = itemClass();
            setStatusBadge(container, 'paused');
            const paused = itemClass();
            setStatusBadge(container, 'idle');
            const cleared = itemClass();
            // No badge in the container: the guard must stay in front of the publication.
            const before = emitted.length;
            setStatusBadge(document.createElement('div'), 'playing');
            const guarded = emitted.length === before;

            window.removeEventListener('llm-workbench:workflow-busy', onBusy);
            window.removeEventListener('llm-workbench:replay-status', onRetired);
            return { emitted, retired: retired.length, marked, paused, cleared, guarded };
          }
        """)
        checks.check(
            view_half["emitted"] == [
                {"workflow": "replay-translate", "busy": True},
                {"workflow": "replay-translate", "busy": False},
                {"workflow": "replay-translate", "busy": False},
            ],
            f"the replay view published unexpected busy events: {view_half['emitted']}",
        )
        checks.check(view_half["retired"] == 0, "the replay view still emits the retired event")
        checks.check(
            "is-running" in view_half["marked"],
            "the replay view's own status did not mark the sidebar item",
        )
        checks.check(
            "is-running" not in view_half["paused"],
            "a paused replay is reported as busy",
        )
        checks.check(
            "is-running" not in view_half["cleared"],
            "the replay view did not clear the sidebar item",
        )
        checks.check(
            view_half["guarded"],
            "a container without the status badge still published a busy event",
        )
        busy.close()
        checks.note("busy indicator: shell and view halves both covered, retired event is gone")

        # --- the sidebar is rendered from the global that /plugins.js sets ---
        # Python owns the list; this is the wiring between the two.
        served = browser.new_page()
        served.goto(f"{base}/#pdf-anatomy")
        served.wait_for_selector("#appRoot > *", timeout=10000)
        wiring = served.evaluate("""
          () => ({
            isArray: Array.isArray(window.__LLM_WORKBENCH_PLUGINS__),
            plugins: (window.__LLM_WORKBENCH_PLUGINS__ || []).length,
            categories: document.querySelectorAll('#workflowList .sidebar-section-label').length,
            items: document.querySelectorAll('#workflowList li[data-route]').length,
          })
        """)
        checks.check(wiring["isArray"], "the generated plugin global is not set in the browser")
        checks.check(wiring["plugins"] == 8, f"payload carries {wiring['plugins']} plugins, expected 8")
        checks.check(wiring["categories"] == 7, f"sidebar shows {wiring['categories']} categories")
        checks.check(wiring["items"] == 20, f"sidebar shows {wiring['items']} items")
        served.close()
        checks.note("sidebar: rendered from the generated global, 8 plugins into 7 categories")

        # --- one category on: the menu shrinks and the landing follows it ---
        # `plugins.enabled` in config/settings.json can switch every other category off, and the
        # frontend only ever sees the list that survives. This serves that list: the payload the
        # running server generated, with only Image Pool left in it. The Python half of the switch
        # is covered in tests/test_plugin_registry.py.
        solo = browser.new_page()
        with urllib.request.urlopen(f"{base}/plugins.js") as response:
            body = response.read().decode("utf-8")
        prefix = "window.__LLM_WORKBENCH_PLUGINS__ = "
        payload = json.loads(body[len(prefix):].rstrip().rstrip(";"))
        isolated = [plugin for plugin in payload if plugin["id"] == "image-pool"]
        checks.check(len(isolated) == 1, "the served payload holds no image-pool category to isolate")
        solo_body = prefix + json.dumps(isolated) + ";\n"
        solo.route(
            "**/plugins.js",
            lambda route: route.fulfill(
                status=200, content_type="application/javascript", body=solo_body
            ),
        )
        solo.goto(f"{base}/")
        try:
            solo.wait_for_selector("#appRoot > *", timeout=10000)
            solo_labels = solo.eval_on_selector_all(
                "#workflowList .sidebar-section-label", "els => els.map(e => e.textContent.trim())"
            )
            checks.check(solo_labels == ["Image Pool"], f"single-category labels: {solo_labels}")
            solo_routes = solo.eval_on_selector_all(
                "#workflowList li[data-route]", "els => els.map(e => e.dataset.route)"
            )
            checks.check(
                solo_routes == [
                    "image-pool-models", "image-generation", "image-lora-library", "image-train",
                ],
                f"single-category routes: {solo_routes}",
            )
            landed = solo.get_attribute('li[data-route="image-pool-models"]', "class") or ""
            checks.check(
                "active" in landed,
                "the workbench did not land on the first view of the only category",
            )
            checks.check(
                solo.query_selector(".workflow-error") is None,
                "a single-category menu rendered an error panel",
            )
            checks.check(
                solo.eval_on_selector_all("#appRoot > *", "els => els.length") == 1,
                "a single-category menu does not hold exactly one view",
            )
            # A hash typed during the session, not just on load: without the fallback the address
            # bar would keep showing a route the workbench is not on.
            solo.evaluate("window.location.hash = '#chat'")
            solo.wait_for_timeout(300)
            checks.check(
                solo.url.endswith("#image-pool-models"),
                f"a hash outside the menu was left in the address bar: {solo.url}",
            )

            # A bookmark to a view whose category is off has no route to resolve. The shell falls
            # back to the landing route, which is what makes a shrunk menu harmless for old links.
            solo.goto(f"{base}/#chat")
            solo.reload()
            solo.wait_for_selector("#appRoot > *", timeout=10000)
            checks.check(
                solo.url.endswith("#image-pool-models"),
                f"a route outside the menu did not fall back to the landing: {solo.url}",
            )
            checks.check(
                solo.query_selector(".workflow-error") is None,
                "a route outside the menu showed an error panel instead of the landing view",
            )
        except Exception as error:  # noqa: BLE001 - reported as a problem
            problems.append(f"a single-category menu did not work: {error}")
        solo.close()
        checks.note("single category: one section, four views, lands on its first view")

        # --- a plugin list that never arrives is visible, not just logged ---
        # The load order is guaranteed, but the request can still fail. The inline boot script has
        # already revealed the shell by then, so the reason has to end up on screen.
        missing = browser.new_page()
        missing.route("**/plugins.js", lambda route: route.abort())
        missing.goto(f"{base}/#pdf-anatomy")
        try:
            missing.wait_for_selector(".workflow-error", timeout=5000)
            text = missing.inner_text(".workflow-error")
            checks.check("plugin list" in text.lower(), f"panel does not name the plugin list: {text!r}")
            checks.check(
                "Reload the page" in text,
                f"panel does not tell the reader what to do: {text!r}",
            )
            checks.check(
                "plugins.enabled" in text,
                f"panel does not name the setting that can cause this: {text!r}",
            )
            checks.check(
                "__LLM_WORKBENCH_PLUGINS__" in text,
                f"panel does not name the missing global: {text!r}",
            )
            checks.check(
                missing.eval_on_selector_all("#workflowList li[data-route]", "els => els.length") == 0,
                "the sidebar rendered items without a plugin list",
            )
        except Exception as error:  # noqa: BLE001 - reported as a problem
            problems.append(f"a missing plugin list was not shown to the user: {error}")
        missing.close()
        checks.note("missing plugin list: visible panel with the reason, no silent empty shell")

        # --- a plugin list the server refuses is visible too ---
        # A typo in plugins.enabled makes /plugins.js raise, which FastAPI answers with a 500 and a
        # text/plain body. The script tag then never sets the global, so the same panel has to
        # appear: this is what that typo looks like to the person who made it.
        refused = browser.new_page()
        refused.route(
            "**/plugins.js",
            lambda route: route.fulfill(
                status=500, content_type="text/plain", body="Internal Server Error"
            ),
        )
        refused.goto(f"{base}/#pdf-anatomy")
        try:
            refused.wait_for_selector(".workflow-error", timeout=5000)
            text = refused.inner_text(".workflow-error")
            checks.check("plugin list" in text.lower(), f"panel does not name the plugin list: {text!r}")
            checks.check(
                refused.eval_on_selector_all("#workflowList li[data-route]", "els => els.length") == 0,
                "the sidebar rendered items without a plugin list",
            )
        except Exception as error:  # noqa: BLE001 - reported as a problem
            problems.append(f"a refused plugin list was not shown to the user: {error}")
        refused.close()
        checks.note("refused plugin list: the 500 from a bad plugins.enabled is visible on screen")

        # --- a plugin from an installed package: escaped, styled, with its own icon ---
        # The payload can carry data from a package since phase 5, so the sidebar has to escape it,
        # link the plugin's stylesheet, and render a path icon as an image. Nothing is installed
        # here, so the files themselves 404; what is measured is what the shell does with the data.
        packaged = browser.new_page()
        injected = '<img src=x onerror="window.__injected = true">'
        probe_payload = [{
            "id": "probe-package",
            "label": injected,
            "auxiliary": False,
            "styles": ["plugin-static/probe-package/plugin.css"],
            "views": [{
                "id": "probe-view",
                "route": "probe-view",
                "name": injected,
                "icon": "plugin-static/probe-package/icon.svg",
                "tooltip": injected,
                "persistent": True,
                "module": "plugin-static/probe-package/view.js",
                "factory": "createView",
                "aliases": [],
            }],
        }]
        packaged.route(
            "**/plugins.js",
            lambda route: route.fulfill(
                status=200,
                content_type="application/javascript",
                body="window.__LLM_WORKBENCH_PLUGINS__ = " + json.dumps(probe_payload) + ";\n",
            ),
        )
        packaged.goto(f"{base}/")
        try:
            packaged.wait_for_selector("#workflowList li[data-route]", timeout=10000)
            checks.check(
                packaged.evaluate("window.__injected === undefined"),
                "the sidebar executed markup from the plugin list",
            )
            label = packaged.inner_text("#workflowList .sidebar-section-label")
            # De sectiekop wordt door css in hoofdletters gezet, vandaar de kleine-lettervergelijking.
            checks.check("<img" in label.lower(), f"the label is not rendered as text: {label!r}")
            icon_src = packaged.eval_on_selector(
                "#workflowList img.app-icon", "el => el.getAttribute('src')"
            )
            checks.check(
                icon_src.endswith("/plugin-static/probe-package/icon.svg"),
                f"path icon src: {icon_src!r}",
            )
            links = packaged.eval_on_selector_all(
                "link[data-plugin-style]", "els => els.map(e => e.getAttribute('href'))"
            )
            checks.check(
                any(href.endswith("/plugin-static/probe-package/plugin.css") for href in links),
                f"plugin stylesheet not linked: {links}",
            )
        except Exception as error:  # noqa: BLE001 - reported as a problem
            problems.append(f"a packaged plugin was not rendered safely: {error}")
        packaged.close()
        checks.note("packaged plugin: label escaped, stylesheet linked, path icon rendered as an image")

        checks.check(not page_errors, f"page errors: {page_errors}")
        checks.check(not import_failures, f"dynamic import failures: {import_failures}")
        browser.close()


def main() -> int:
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    # The shipped defaults, in a file of their own: see the module docstring.
    shipped_dir = tempfile.mkdtemp(prefix="llm-workbench-shipped-")
    shipped = Path(shipped_dir) / "settings.json"
    shipped.write_bytes((REPO_ROOT / "config" / "settings.json").read_bytes())
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
        cwd=REPO_ROOT,
        env={**os.environ, "LLM_WORKBENCH_SETTINGS_FILE": str(shipped)},
    )
    checks = Checks()
    try:
        wait_for_server(port)
        verify(base, checks)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
        shutil.rmtree(shipped_dir, ignore_errors=True)

    if checks.problems:
        print(f"\nPROBLEMS ({len(checks.problems)}):")
        for problem in checks.problems:
            print(f"  - {problem}")
        return 1
    print("\nOK: sidebar, routes, aliases, persistence, theming, placeholder, error panel, retry,")
    print("    busy indicator, a single-category menu, no refetch on a deterministic failure, and")
    print("    no error-level log on a discarded view.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
