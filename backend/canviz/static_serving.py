"""
backend/canviz/static_serving.py

Patch to add to your existing FastAPI app (main.py or app.py) in Phase 2.
Shows how to:
  1. Mount the built React frontend as static files.
  2. Register the replay router.
  3. Serve index.html for any unknown path (SPA fallback).

Assumptions:
- Your FastAPI app object is called `app`.
- The built frontend lives at `canviz/static/` (Vite output → this dir).
- This module is imported once at startup — add the import to your main.py.
"""

from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# ---------------------------------------------------------------------------
# Import the replay router (new in Phase 2)
# ---------------------------------------------------------------------------
# from canviz.routers.replay import router as replay_router
# app.include_router(replay_router)

# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).parent / "static"


def mount_frontend(app: FastAPI) -> None:
    """
    Mount the built React app.

    Call this AFTER all API routes are registered so the catch-all
    SPA fallback does not shadow API endpoints.

    Usage in main.py:
        from canviz.static_serving import mount_frontend
        mount_frontend(app)
    """
    if not STATIC_DIR.exists():
        # Static dir missing — probably running in dev mode without a build.
        # Dev users hit http://localhost:5173 (Vite) directly instead.
        return

    # Serve /assets/* and other static files
    app.mount(
        "/assets",
        StaticFiles(directory=STATIC_DIR / "assets"),
        name="assets",
    )

    # SPA fallback — all unknown GET paths return index.html
    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):  # noqa: ARG001
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(index)
        return {"detail": "Frontend not built. Run: cd frontend && npm run build"}


# ---------------------------------------------------------------------------
# Auto-open browser on `canviz` launch (optional)
# ---------------------------------------------------------------------------

def open_browser(port: int = 8080) -> None:
    """Open the default browser after a short delay so FastAPI starts first."""
    import threading
    import webbrowser

    def _open():
        import time
        time.sleep(1.2)
        webbrowser.open(f"http://localhost:{port}")

    threading.Thread(target=_open, daemon=True).start()
