from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles

from app.router import api_router
from app.realtime_tts.replay import websocket_endpoint as realtime_tts_websocket_endpoint
from app.realtime_translation.replay.replay import websocket_endpoint

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


@app.websocket("/ws/replay/{session_id}")
async def ws_replay(websocket: WebSocket, session_id: str):
    await websocket_endpoint(websocket, session_id)


@app.websocket("/ws/replay-speak/{session_id}")
async def ws_replay_speak(websocket: WebSocket, session_id: str):
    await realtime_tts_websocket_endpoint(websocket, session_id)


if static_dir.exists():
    app.mount("/", RevalidatingStaticFiles(directory=str(static_dir), html=True), name="static")
