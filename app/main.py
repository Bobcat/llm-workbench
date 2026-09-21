from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Response, WebSocket
from fastapi.staticfiles import StaticFiles

from app.plugins import PACKAGE_MOUNT_PREFIX, discovered_packages, frontend_script
from app.realtime_tts.replay import websocket_endpoint as realtime_tts_websocket_endpoint
from app.realtime_translation.replay.replay import websocket_endpoint
from app.router import api_router

base_dir = Path(__file__).parent.parent
static_dir = base_dir / "static"


class RevalidatingStaticFiles(StaticFiles):
    """Static files the browser has to revalidate before reusing.

    The frontend has no build step: a changed module keeps its URL, and nothing in the response
    tells the browser it is stale. Without a Cache-Control header browsers fall back to
    heuristic freshness — roughly a fraction of the time since Last-Modified — and may reuse a
    module for days. That matters because views are imported lazily: a hard reload refreshes the
    startup graph but not the module fetched when a view is first opened.

    ``no-cache`` means "revalidate", not "do not store": unchanged files still answer 304.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["cache-control"] = "no-cache"
        return response


app = FastAPI(
    title="LLM Workbench",
    description="API for LLM translation workflows",
    version="0.1.0",
)

app.include_router(api_router)

# The two websockets are the only routes outside /api. Like the routers, they belong to the core:
# which category shows them does not decide whether they exist.


@app.websocket("/ws/replay/{session_id}")
async def ws_replay(websocket: WebSocket, session_id: str):
    await websocket_endpoint(websocket, session_id)


@app.websocket("/ws/replay-speak/{session_id}")
async def ws_replay_speak(websocket: WebSocket, session_id: str):
    await realtime_tts_websocket_endpoint(websocket, session_id)


@app.get("/plugins.js", include_in_schema=False)
def plugins_js() -> Response:
    """The plugin list, generated from ``app/plugins.py``.

    ``static/index.html`` loads this with a blocking script tag before ``app.js``, so the sidebar
    renders synchronously from a list Python owns. Which categories end up in it comes from
    ``config/settings.json`` (``plugins.enabled``), read per request, so switching a category only
    needs a page reload. Registered before the static mount, which would otherwise serve a file of
    that name.
    """
    return Response(
        content=frontend_script(),
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


# A plugin package's frontend files, served under their own prefix. This has to come before the
# catch-all mount below, which would otherwise answer with the shell.
for _package in discovered_packages():
    app.mount(
        f"/{PACKAGE_MOUNT_PREFIX}/{_package.plugin.id}",
        RevalidatingStaticFiles(directory=str(_package.static_dir)),
        name=f"plugin-{_package.plugin.id}",
    )

if static_dir.exists():
    app.mount("/", RevalidatingStaticFiles(directory=str(static_dir), html=True), name="static")
