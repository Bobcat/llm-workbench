from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.staticfiles import StaticFiles

from app.plugins import frontend_script, iter_websockets
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

# The websockets come from the registry too, so a view and the socket it connects to are
# declared in the same place. They are the only routes outside /api.
for _socket in iter_websockets():
    app.websocket(_socket.path)(_socket.endpoint)


@app.get("/plugins.js", include_in_schema=False)
def plugins_js() -> Response:
    """The plugin list, generated from ``app/plugins.py``.

    ``static/index.html`` loads this with a blocking script tag before ``app.js``, so the sidebar
    renders synchronously from a list Python owns. Registered before the static mount, which
    would otherwise serve a file of that name.
    """
    return Response(
        content=frontend_script(),
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache"},
    )


if static_dir.exists():
    app.mount("/", RevalidatingStaticFiles(directory=str(static_dir), html=True), name="static")
