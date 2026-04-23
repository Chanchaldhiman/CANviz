"""
canviz/server.py
----------------
Assembles the FastAPI app - mounts all routers, configures CORS
(browser -> localhost needs it), and wires startup/shutdown via lifespan.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from canviz.routers import connect, frames, dbc, log
from canviz.bus import bus_manager
from canviz.ws_broadcaster import broadcaster
from canviz.routers.replay import router as replay_router, set_broadcast_fn
from canviz.static_serving import mount_frontend
from canviz.routers import stats as stats_router

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup - nothing to do; connections are opened on demand via /connect
    yield
    # shutdown - clean up bus and broadcaster gracefully
    await broadcaster.stop()
    await bus_manager._hard_shutdown()


app = FastAPI(
    title="CANvas",
    description="Open-source browser-based CAN bus analyzer",
    version="0.1.0",
    lifespan=lifespan,
)
class CrossOriginIsolationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
        return response
    
# Allow the React dev server (port 5173) and the bundled UI (same origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(CrossOriginIsolationMiddleware)

app.include_router(connect.router)
app.include_router(frames.router)
app.include_router(dbc.router)
app.include_router(log.router)
app.include_router(stats_router.router)

app.include_router(replay_router)
async def _replay_broadcast(frame_dict: dict) -> None:
    """Puts a replay frame dict directly onto the broadcaster queue."""
    if broadcaster._queue is not None:
        try:
            broadcaster._queue.put_nowait(frame_dict)
        except Exception:
            pass

set_broadcast_fn(_replay_broadcast)

mount_frontend(app)

@app.get("/")
async def root():
    return {"name": "CANvas", "version": "0.1.0", "docs": "/docs"}
