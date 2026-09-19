"""The plugin registry: which sidebar categories and views exist, and what serves them.

This is the source of truth for the frontend sidebar. ``/plugins.js`` is generated from
:func:`frontend_payload`, ``app/router.py`` mounts the routers from :func:`iter_routers`, and
``app/main.py`` registers the websockets from :func:`iter_websockets`, so the route table and the
sidebar cannot drift apart without the tests in ``tests/test_plugin_registry.py`` noticing.

Decisions behind the shape, and what was rejected, are in ``docs/plugin-architecture.md``.
Three of them matter when reading this file:

- ``routers`` on a view is **every** router serving an endpoint that view calls, including
  routers that belong to another plugin: ``image-train`` reads its model list from
  ``llm_pool_router``, so that router is listed there too. A complete list is what makes "does
  this view have its backend" answerable per view, and it is what phase 3 needs to see which
  views lose something when a plugin is switched off.
- The list is written by hand rather than derived. Deriving it from the frontend would work
  today, but the frontend calls ``api.runChatPrompt()`` and the path lives in
  ``static/src/api-client.js``, which phase 4 splits up. A second check in the tests verifies
  that the declared routers really do cover what the view calls.
- One router can serve several views. :func:`iter_routers` deduplicates by identity, so sharing
  one is not a mistake here.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Awaitable, Callable

from fastapi import APIRouter

from app.image_pool.loras import router as image_pool_loras_router
from app.image_pool.models import router as image_pool_router
from app.image_pool.training import router as image_pool_training_router
from app.llm_pool.models import router as llm_pool_router
from app.prompt_testing.chat import router as chat_router
from app.prompt_testing.text_generation import router as text_generation_router
from app.realtime_translation.prompt_library.prompts import router as prompt_library_router
from app.realtime_translation.replay.defaults import router as replay_defaults_router
from app.realtime_translation.replay.replay import router as replay_router
from app.realtime_translation.replay.replay import websocket_endpoint as replay_socket_endpoint
from app.realtime_tts.replay import router as realtime_tts_router
from app.realtime_tts.replay import websocket_endpoint as replay_speak_socket_endpoint
from app.translation_services.benchmark import router as pdf_benchmark_router
from app.translation_services.pdf import router as pdf_translation_router
from app.translation_services.pdf_regression import router as pdf_regression_router
from app.translation_services.proxy import router as translation_router
from app.tts_pool.models import router as tts_pool_router
from app.video_pool.models import router as video_pool_router

FRONTEND_GLOBAL = "__LLM_WORKBENCH_PLUGINS__"


@dataclass(frozen=True)
class ViewSocket:
    """A websocket a view connects to: the only application routes outside /api.

    ``client`` names the browser class that connects. The check that a declared socket is really
    used reads that name instead of deriving it from the path: deriving it coupled this registry to
    a JS naming convention nobody enforces, so renaming ``ReplaySpeakWebSocket`` consistently
    failed the test while the declaration was still correct.
    """

    path: str
    endpoint: Callable[..., Awaitable[None]]
    client: str


@dataclass(frozen=True)
class View:
    """One sidebar entry and the frontend module that renders it.

    ``backend`` is False only for a view that genuinely has no API behind it. Saying so
    explicitly is what lets the tests tell "has no backend" apart from "someone forgot to map
    one".

    ``routers`` and ``websockets`` together are everything the view talks to. Listing a router
    that belongs to another plugin is intentional and expected: the model dropdowns are served
    by llm-pool from six other plugins' views.
    """

    id: str
    route: str
    name: str
    icon: str
    module: str
    factory: str
    routers: tuple[APIRouter, ...] = ()
    websockets: tuple[ViewSocket, ...] = ()
    aliases: tuple[str, ...] = ()
    tooltip: str | None = None
    persistent: bool = True
    backend: bool = True


@dataclass(frozen=True)
class Plugin:
    """One sidebar category, or one standalone item when ``auxiliary`` is set."""

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
                routers=(replay_router, replay_defaults_router, llm_pool_router, translation_router),
                websockets=(ViewSocket(
                        "/ws/replay/{session_id}",
                        replay_socket_endpoint,
                        client="ReplayWebSocket",
                    ),),
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
                routers=(realtime_tts_router, tts_pool_router),
                websockets=(ViewSocket(
                        "/ws/replay-speak/{session_id}",
                        replay_speak_socket_endpoint,
                        client="ReplaySpeakWebSocket",
                    ),),
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
                routers=(llm_pool_router,),
            ),
            View(
                id="text-generation",
                route="text-generation",
                name="Text generation",
                icon="file-plus",
                module="src/workflows/text-generation/index.js",
                factory="createTextGenerationView",
                routers=(text_generation_router, llm_pool_router),
                aliases=("ad-hoc-prompt", "vlm-test"),
            ),
            View(
                id="chat",
                route="chat",
                name="Chat",
                icon="messages-square",
                module="src/workflows/chat/index.js",
                factory="createChatView",
                routers=(chat_router, llm_pool_router),
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
                routers=(tts_pool_router,),
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
                routers=(image_pool_router,),
            ),
            View(
                id="image-generation",
                route="image-generation",
                name="Image generation",
                icon="image-plus",
                module="src/workflows/image-generation/index.js",
                factory="createImageGenerationView",
                routers=(image_pool_router, image_pool_loras_router),
            ),
            View(
                id="image-lora-library",
                route="image-lora-library",
                name="LoRA Library",
                icon="layers-3",
                module="src/workflows/lora-library/index.js",
                factory="createLoraLibraryView",
                routers=(image_pool_loras_router,),
            ),
            View(
                id="image-train",
                route="image-train",
                name="Tuning",
                icon="sliders-horizontal",
                module="src/workflows/image-train/index.js",
                factory="createImageTrainView",
                routers=(image_pool_training_router, llm_pool_router),
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
                routers=(video_pool_router,),
            ),
            View(
                id="video-generation",
                route="video-generation",
                name="Video generation",
                icon="video-plus",
                module="src/workflows/video-generation/index.js",
                factory="createVideoGenerationView",
                routers=(video_pool_router,),
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
                routers=(translation_router, llm_pool_router),
                aliases=("translation-requests",),
            ),
            View(
                id="image-translation-regression",
                route="image-translation-regression",
                name="Image regression testing",
                icon="clipboard-check",
                module="src/workflows/image-translation-regression/index.js",
                factory="createImageTranslationRegressionView",
                routers=(translation_router,),
                aliases=("translation-regression",),
            ),
            View(
                id="pdf-translation",
                route="pdf-translation",
                name="PDF translation",
                icon="file-text",
                module="src/workflows/pdf-translation/index.js",
                factory="createPdfTranslationView",
                routers=(
                    pdf_translation_router,
                    pdf_benchmark_router,
                    pdf_regression_router,
                    translation_router,
                    llm_pool_router,
                ),
            ),
            View(
                id="pdf-translation-regression",
                route="pdf-translation-regression",
                name="PDF regression testing",
                icon="clipboard-check",
                module="src/workflows/pdf-translation-regression/index.js",
                factory="createPdfTranslationRegressionView",
                routers=(pdf_regression_router,),
            ),
            View(
                id="pdf-testing",
                route="pdf-testing",
                name="PDF benchmark",
                icon="gauge",
                module="src/workflows/pdf-testing/index.js",
                factory="createPdfTestingView",
                routers=(pdf_benchmark_router,),
            ),
            View(
                id="pdf-anatomy",
                route="pdf-anatomy",
                name="PDF anatomy",
                icon="venetian-mask",
                module="src/workflows/pdf-anatomy/index.js",
                factory="createPdfAnatomyView",
                routers=(pdf_regression_router,),
            ),
            View(
                id="prompt-library",
                route="prompt-library",
                name="Prompt Library",
                icon="book-open-text",
                module="src/workflows/translation-prompts/index.js",
                factory="createTranslationPromptsView",
                routers=(prompt_library_router, translation_router, llm_pool_router),
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
                backend=False,
            ),
        ),
    ),
)


def iter_views() -> tuple[View, ...]:
    """Every view, in sidebar order."""
    return tuple(view for plugin in PLUGINS for view in plugin.views)


def iter_routers() -> tuple[APIRouter, ...]:
    """Every router the workbench mounts, in registry order and without duplicates."""
    seen: set[int] = set()
    routers: list[APIRouter] = []
    for view in iter_views():
        for router in view.routers:
            if id(router) in seen:
                continue
            seen.add(id(router))
            routers.append(router)
    return tuple(routers)


def iter_websockets() -> tuple[ViewSocket, ...]:
    """Every websocket the workbench serves, in registry order and without duplicates."""
    seen: set[str] = set()
    sockets: list[ViewSocket] = []
    for view in iter_views():
        for socket in view.websockets:
            if socket.path in seen:
                continue
            seen.add(socket.path)
            sockets.append(socket)
    return tuple(sockets)


def route_aliases() -> dict[str, str]:
    """Retired route names, mapped to the route that replaced them."""
    return {
        alias: view.route
        for view in iter_views()
        for alias in view.aliases
    }


def frontend_payload() -> list[dict[str, object]]:
    """The plugin list as the browser needs it: data only, no router objects."""
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
        for plugin in PLUGINS
    ]


def frontend_script() -> str:
    """The generated ``/plugins.js``: one global, loaded before ``app.js``.

    Served synchronously rather than fetched, because the list does not change during a session
    and a fetch would only add an empty-sidebar state to design for.
    """
    payload = json.dumps(frontend_payload(), ensure_ascii=True, separators=(",", ":"))
    return f"window.{FRONTEND_GLOBAL} = {payload};\n"
