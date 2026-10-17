"""`hako-tools`: list the catalog, probe endpoints live with their published example, dump catalog JSON.

  hako-tools list                       every endpoint id, price and availability
  hako-tools probe <id> [<id> …]        run each example through the real engine (spends provider credits)
  hako-tools probe --provider <p>       probe every endpoint of one provider
  hako-tools catalog > catalog.json     the compiled catalog
"""

import asyncio
import sys
import time

import orjson
from dotenv import load_dotenv

from hako_core.cache.store import cache
from hako_tools.connectors import load
from hako_tools.framework import catalog
from hako_tools.framework.context import close_clients
from hako_tools.framework.endpoint import REGISTRY
from hako_tools.framework.engine import run
from hako_tools.framework.errors import ToolError

_MS_PER_S = 1000
_PREVIEW_CHARS = 240
_MIN_ARGS = 2


async def _probe(ids: list[str]) -> int:
    cache.setup(None)
    failures = 0
    for endpoint_id in ids:
        endpoint = REGISTRY[endpoint_id]
        started = time.monotonic()
        try:
            env = await run(endpoint_id, endpoint.example)
            size = len(orjson.dumps(env))
            ms = round((time.monotonic() - started) * _MS_PER_S)
            print(f"OK   {endpoint_id:38} {ms:5d} ms {size:6d} B found={env['found']}")
            print(f"     {orjson.dumps(env['data']).decode()[:_PREVIEW_CHARS]}")
        except ToolError as exc:
            failures += 1
            ms = round((time.monotonic() - started) * _MS_PER_S)
            print(f"FAIL {endpoint_id:38} {ms:5d} ms {exc.code}: {exc.message} {exc.details}")
    await close_clients()
    return failures


def main() -> None:
    load_dotenv(override=False)
    load()
    args = sys.argv[1:]
    if not args or args[0] == "list":
        for e in catalog.endpoints():
            print(f"{e.id:40} ${e.price.usd:6} {'ok ' if e.available else 'off'} {e.display_name}")
        return
    if args[0] == "catalog":
        sys.stdout.write(orjson.dumps(catalog.compiled(), option=orjson.OPT_INDENT_2).decode())
        return
    if args[0] == "probe":
        if len(args) > _MIN_ARGS and args[1] == "--provider":
            ids = [e.id for e in catalog.endpoints() if e.provider.id == args[2]]
        else:
            ids = args[1:] or [e.id for e in catalog.endpoints() if e.available]
        sys.exit(1 if asyncio.run(_probe(ids)) else 0)
    sys.exit(__doc__)
