"""`hako-task <name>`: periodic jobs, run by Coolify scheduled tasks inside the api container.

  gdelt   refresh the local GDELT news index (hako/news)
  jobs    refresh the 89 ATS job boards (hako/jobs)
  probe   run every keyless endpoint's example, past the cache, so health has fresh samples (keyed ones get
          theirs from traffic); scheduled every 10 min, inside HEALTH_RECENT_S (15 min)
"""

import asyncio
import sys
from collections.abc import Awaitable, Callable
from typing import Any

import orjson
from dotenv import load_dotenv

from hako_core.cache.store import cache
from hako_core.obs.logging import configure_logging
from hako_core.settings import get_settings
from hako_now.jobs import ingest as jobs
from hako_now.news import ingest as gdelt
from hako_tools.connectors import load
from hako_tools.framework import catalog
from hako_tools.framework.context import close_clients
from hako_tools.framework.engine import run
from hako_tools.framework.errors import ToolError
from hako_tools.framework.health import health

_ARGC = 2  # program name + task name


async def probe() -> dict[str, Any]:
    load()
    keyless = [e for e in catalog.endpoints() if e.available and e.keyless]
    failed: list[str] = []
    for endpoint in keyless:
        try:
            await run(endpoint.id, endpoint.example, fresh=True)
        except ToolError as exc:
            failed.append(f"{endpoint.id}: {exc.code}")
    await close_clients()
    await health.close()
    return {"probed": len(keyless), "failed": failed}


TASKS: dict[str, Callable[[], Awaitable[dict[str, Any]]]] = {"gdelt": gdelt.run, "jobs": jobs.run, "probe": probe}


async def _run(name: str) -> dict[str, Any]:
    cache.setup(get_settings().redis_url)
    try:
        return await TASKS[name]()
    finally:
        await gdelt.client().aclose()
        await cache.close()


def main() -> None:
    load_dotenv(override=False)
    configure_logging(get_settings().log_level)
    if len(sys.argv) != _ARGC or sys.argv[1] not in TASKS:
        sys.exit(f"usage: hako-task {{{'|'.join(TASKS)}}}")
    print(orjson.dumps(asyncio.run(_run(sys.argv[1]))).decode())
