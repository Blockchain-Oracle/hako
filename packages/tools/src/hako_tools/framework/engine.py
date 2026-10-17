"""Run one endpoint: validate → cache → handler under the deadline → validate output → fit → envelope.

Identical for every provider. A failure raises a ToolError (non-2xx: the x402 payment is never settled); a
"does not exist" answer returns 200 with `billable: false`.
"""

import asyncio
import functools
import hashlib
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import orjson
import structlog
from pydantic import ValidationError

from hako_core.cache.keys import cache_key
from hako_core.cache.store import cache
from hako_core.deadline import Deadline, set_deadline
from hako_tools.constants import RUN_DEADLINE_MAX_S, SERVICE_ID
from hako_tools.framework.context import RunContext
from hako_tools.framework.endpoint import REGISTRY, Endpoint
from hako_tools.framework.errors import (
    InvalidToolInput,
    OutputContractError,
    RunDeadlineExceeded,
    ToolError,
    ToolNotFoundResult,
    ToolUnavailable,
    UnknownEndpoint,
)
from hako_tools.framework.health import health
from hako_tools.framework.sizing import fit

log = structlog.get_logger(__name__)
_MS_PER_S = 1000
_MAX_ERROR_DETAILS = 8
_INPUT_HASH_BYTES = 16
_CACHE_SVC = "tools"


def resolve(endpoint_id: str) -> Endpoint:
    endpoint = REGISTRY.get(endpoint_id)
    if endpoint is None:
        raise UnknownEndpoint(
            f"no endpoint {endpoint_id!r}", details=["POST /v1/discover with {query} to find one"]
        )
    if not endpoint.available:
        raise ToolUnavailable(f"{endpoint.provider.display_name} is not configured on this server")
    return endpoint


def validate_input(endpoint: Endpoint, payload: Any) -> Any:
    try:
        return endpoint.input_model.model_validate(payload if payload is not None else {})
    except ValidationError as exc:
        details = [
            f"{'.'.join(str(p) for p in e['loc']) or 'body'}: {e['msg']}" for e in exc.errors()[:_MAX_ERROR_DETAILS]
        ]
        raise InvalidToolInput(f"input does not match {endpoint.id}'s schema", details=details) from exc


@functools.cache
def _contract(endpoint_id: str) -> bytes:
    """The endpoint's published contract (description, schemas, price, notes…), sorted. It is part of every cache
    key, so a deploy that changes a tool retires the answers its previous code cached instead of serving them."""
    return orjson.dumps(REGISTRY[endpoint_id].doc(), option=orjson.OPT_SORT_KEYS)


def _cache_id(endpoint: Endpoint, canonical: bytes) -> str:
    digest = hashlib.blake2b(_contract(endpoint.id) + canonical, digest_size=_INPUT_HASH_BYTES).hexdigest()
    return cache_key(_CACHE_SVC, endpoint.provider.id, endpoint.slug, digest)


def _envelope(endpoint: Endpoint, deadline: Deadline, *, data: Any, sources: list[Any], notes: list[str],
              found: bool, cached: bool) -> dict[str, Any]:
    # Field order is byte order: safe metadata first, untrusted provider data last.
    return {
        "service": SERVICE_ID,
        "endpoint": endpoint.id,
        "provider": endpoint.provider.id,
        "status": "ok",
        "found": found,
        "billable": found and not endpoint.price.free,  # a free read is never charged
        "cached": cached,
        "as_of": datetime.now(UTC).isoformat(timespec="seconds"),
        "elapsed_ms": deadline.elapsed_ms(),
        "price": endpoint.price.doc(),
        "render": endpoint.render.value,
        "notes": notes,
        "sources": sources,
        "data": data,
    }


async def run(endpoint_id: str, payload: Any, *, fresh: bool = False) -> dict[str, Any]:
    """`fresh` skips the cache read (the probe task: a cache hit records no health sample) but still refreshes it."""
    endpoint = resolve(endpoint_id)
    inp = validate_input(endpoint, payload)
    deadline = Deadline(min(endpoint.deadline_s, RUN_DEADLINE_MAX_S))
    set_deadline(deadline)
    canonical = orjson.dumps(inp.model_dump(mode="json"), option=orjson.OPT_SORT_KEYS)
    key = _cache_id(endpoint, canonical) if endpoint.cache_ttl_s else None
    if key and not fresh:
        hit = await cache.get(key)
        if hit is not None:
            return _envelope(endpoint, deadline, data=hit["data"], sources=hit["sources"], notes=hit["notes"],
                             found=True, cached=True)
    ctx = RunContext(endpoint, deadline)
    started = time.monotonic()
    ok = False
    try:
        async with asyncio.timeout(deadline.remaining()):
            output = await endpoint.handler(inp, ctx)
        try:
            data = endpoint.output_model.model_validate(output).model_dump(mode="json", exclude_none=True)
        except ValidationError as exc:
            log.error("tool_output_contract", endpoint=endpoint.id, errors=exc.error_count())
            raise OutputContractError(f"{endpoint.id} produced output outside its declared schema") from exc
        ok = True  # only a valid answer counts as a healthy run
    except ToolNotFoundResult as nf:
        ok = True
        return _envelope(endpoint, deadline, data={"found": False, "message": nf.message},
                         sources=[s.model_dump(mode="json", exclude_none=True) for s in ctx.sources],
                         notes=ctx.notes, found=False, cached=False)
    except TimeoutError as exc:
        raise RunDeadlineExceeded(f"{endpoint.id} did not finish within {deadline.budget_s:g} s") from exc
    except ToolError:
        raise
    except Exception as exc:
        log.exception("tool_handler_crashed", endpoint=endpoint.id)
        raise OutputContractError(f"{endpoint.id} failed while reading the provider's answer") from exc
    finally:
        await health.record(endpoint.id, ok, round((time.monotonic() - started) * _MS_PER_S))
    data, cut = fit(data)
    if cut:
        ctx.note("Long fields were trimmed to keep the answer under Hako's size cap.")
    sources = [s.model_dump(mode="json", exclude_none=True) for s in ctx.sources]
    if key and endpoint.cache_ttl_s:
        await cache.set(key, {"data": data, "sources": sources, "notes": ctx.notes},
                        ttl=timedelta(seconds=endpoint.cache_ttl_s))
    return _envelope(endpoint, deadline, data=data, sources=sources, notes=ctx.notes, found=True, cached=False)
