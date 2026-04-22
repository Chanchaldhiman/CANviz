from fastapi import APIRouter
from canviz.stats_store import stats

router = APIRouter()


@router.get("/stats")
async def get_stats() -> dict:
    """Return a point-in-time bus statistics snapshot."""
    return stats.snapshot()