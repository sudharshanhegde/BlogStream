import os
import logging
import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler

logger = logging.getLogger(__name__)
_scheduler: AsyncIOScheduler | None = None


async def _ping(url: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            logger.info("Self-ping %s → %s", url, resp.status_code)
    except Exception as exc:
        logger.warning("Self-ping failed: %s", exc)


def start_keep_alive() -> None:
    global _scheduler
    render_url = os.getenv("RENDER_EXTERNAL_URL")
    if not render_url:
        logger.info("RENDER_EXTERNAL_URL not set — skipping self-ping scheduler")
        return

    health_url = render_url.rstrip("/") + "/health"
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(_ping, "interval", minutes=2, args=[health_url], id="self_ping")
    _scheduler.start()
    logger.info("Self-ping scheduler started → %s every 2 min", health_url)


def stop_keep_alive() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
