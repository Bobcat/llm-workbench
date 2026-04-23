from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles

from app.router import api_router
from app.realtime_translation.api.replay import websocket_endpoint, _sessions

# Paths
base_dir = Path(__file__).parent.parent
static_dir = base_dir / "static"

app = FastAPI(
    title="LLM Workbench",
    description="API for LLM translation workflows",
    version="0.1.0",
)

# API routes EERST
app.include_router(api_router)

# WebSocket route
@app.websocket("/ws/replay/{session_id}")
async def ws_replay(websocket: WebSocket, session_id: str):
    await websocket_endpoint(websocket, session_id)

# Static files ALS LAATSTE (zodat het niet WebSocket vangt)
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")


# Test endpoint
@app.get("/test/ws")
def test_ws():
    return {"sessions": list(_sessions.keys())}
