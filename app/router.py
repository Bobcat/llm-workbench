from __future__ import annotations

from fastapi import APIRouter

from app.plugins import iter_routers

api_router = APIRouter(prefix="/api")

# The routers come from the plugin registry (app/plugins.py), which is also what generates the
# sidebar in the browser. Mounting them by hand here is what let the two drift apart before.
for _router in iter_routers():
    api_router.include_router(_router)
