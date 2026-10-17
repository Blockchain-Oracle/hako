"""Upstream client: bounded concurrency, rate limits, deadline-derived timeouts, safe failures."""

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from http import HTTPStatus
from typing import Any

import httpx2
import orjson
import stamina
import structlog
from limits import parse
from limits.aio.storage import MemoryStorage, RedisStorage, Storage
from limits.aio.strategies import MovingWindowRateLimiter

from hako_core.constants.deadlines import DEADLINE_SAFETY_MARGIN_S, DEFAULT_POOL_S, KEEPALIVE_S, NOW_DEADLINE_S
from hako_core.constants.http import HTTP_CLIENT_ERROR_MIN, HTTP_NOT_FOUND
from hako_core.contract.enums import SourceStatus
from hako_core.contract.sources import SourceRef
from hako_core.deadline import Deadline, current_deadline
from hako_core.errors import UpstreamFailure
from hako_core.http.registry import UpstreamSpec
from hako_core.settings import get_settings

_RETRYABLE_STATUS = frozenset({HTTPStatus.BAD_GATEWAY, HTTPStatus.SERVICE_UNAVAILABLE, HTTPStatus.GATEWAY_TIMEOUT})
_RATE_LIMITED = HTTPStatus.TOO_MANY_REQUESTS
_MS_PER_S = 1000
LOG_DETAIL_MAX_CHARS = 200
RATE_WAIT_MIN_S = 0.02  # never spin: sleep at least this long between rate-limit checks
RATE_COOLDOWN_DEFAULT_S = 1.0  # after a 429 without Retry-After: per-second limits recover fast
RATE_COOLDOWN_MAX_S = 900.0  # re-probe at least every 15 min even if Retry-After says hours
log = structlog.get_logger(__name__)


class RetryableStatus(Exception):
    """Raised for transient upstream statuses so stamina can retry them."""


class UpstreamClient:
    """One instance per upstream. Never raises raw httpx2 errors: only UpstreamFailure."""

    def __init__(self, spec: UpstreamSpec, storage: Storage | None = None) -> None:
        settings = get_settings()
        self.spec = spec
        self._gate = asyncio.Semaphore(spec.max_concurrency)
        self._limiter = MovingWindowRateLimiter(storage or MemoryStorage()) if spec.rate else None
        self._rate = parse(spec.rate) if spec.rate else None
        self._cooldown_until = 0.0  # monotonic time before which calls fail fast (upstream said 429)
        self._client = httpx2.AsyncClient(
            base_url=spec.base_url,
            http2=spec.http2,
            follow_redirects=True,
            limits=httpx2.Limits(max_connections=spec.max_concurrency, keepalive_expiry=KEEPALIVE_S),
            headers={"user-agent": f"hako/1.0 (+{settings.repo_url}; mailto:{settings.contact_email})"},
        )

    @property
    def http(self) -> httpx2.AsyncClient:
        """The underlying client, for callers that must drive requests themselves (the SSRF-guarded fetch)."""
        return self._client

    async def aclose(self) -> None:
        await self._client.aclose()

    @asynccontextmanager
    async def _slot(self, deadline: Deadline) -> AsyncIterator[None]:
        """A concurrency slot, waited for no longer than the request deadline allows (a queue behind a slow
        upstream must turn into a clean deadline_exceeded, not a response past the gateway's limit)."""
        try:
            async with asyncio.timeout(max(0.0, deadline.remaining() - DEADLINE_SAFETY_MARGIN_S)):
                await self._gate.acquire()
        except TimeoutError as exc:
            raise UpstreamFailure(self.spec.name, "deadline_exceeded", "queued") from exc
        try:
            yield
        finally:
            self._gate.release()

    async def _admit(self, deadline: Deadline, cost: int) -> None:
        """Take `cost` rate-limit slots, waiting for the window to free up while the deadline allows it.

        Failing fast here would turn a burst (ten citations at once) into false "unavailable" answers.
        `cost` > 1 is for upstreams that bill per item in a batch (Twelve Data: one credit per symbol).
        """
        if time.monotonic() < self._cooldown_until:
            raise UpstreamFailure(self.spec.name, SourceStatus.rate_limited, "cooldown")
        if not (self._limiter and self._rate):
            return
        while not await self._limiter.hit(self._rate, self.spec.name, cost=cost):
            stats = await self._limiter.get_window_stats(self._rate, self.spec.name)
            wait = max(stats.reset_time - time.time(), RATE_WAIT_MIN_S)
            if wait >= deadline.remaining() - DEADLINE_SAFETY_MARGIN_S:
                raise UpstreamFailure(self.spec.name, SourceStatus.rate_limited)
            await asyncio.sleep(wait)

    async def request(self, method: str, url: str, *, cost: int = 1, **kwargs: Any) -> httpx2.Response:
        """One request under the current deadline; retries transient failures on idempotent verbs only."""
        deadline = current_deadline(NOW_DEADLINE_S)
        attempts = self.spec.retry_attempts if method in {"GET", "HEAD"} else 1
        await self._admit(deadline, cost)
        try:
            async for attempt in stamina.retry_context(
                on=(httpx2.TransportError, RetryableStatus), attempts=attempts, timeout=deadline.remaining()
            ):
                with attempt:
                    async with self._slot(deadline):
                        budget = deadline.for_call(self.spec.total_s)  # measured after any wait for the slot
                        if budget <= 0:
                            raise UpstreamFailure(self.spec.name, "deadline_exceeded")
                        timeout = httpx2.Timeout(budget, connect=min(self.spec.connect_s, budget), pool=DEFAULT_POOL_S)
                        resp = await self._client.request(method, url, timeout=timeout, **kwargs)
                    if resp.status_code in _RETRYABLE_STATUS:
                        raise RetryableStatus(str(resp.status_code))
                    return resp
        except httpx2.TimeoutException as exc:
            log.warning("upstream_timeout", upstream=self.spec.name, error=type(exc).__name__)
            raise UpstreamFailure(self.spec.name, "deadline_exceeded") from exc
        except (httpx2.TransportError, RetryableStatus) as exc:
            log.warning(
                "upstream_unavailable", upstream=self.spec.name, error=type(exc).__name__, detail=str(exc)[:200]
            )
            raise UpstreamFailure(self.spec.name, SourceStatus.unavailable) from exc
        raise UpstreamFailure(self.spec.name, SourceStatus.unavailable)

    async def get_json(self, url: str, *, cost: int = 1, **kwargs: Any) -> tuple[Any, SourceRef]:
        """GET a JSON document. 404 → UpstreamFailure(not_found); other non-2xx or non-JSON → unavailable."""
        started = time.monotonic()
        resp = await self.request("GET", url, cost=cost, **kwargs)
        latency = round((time.monotonic() - started) * _MS_PER_S)
        if resp.status_code == HTTP_NOT_FOUND:
            raise UpstreamFailure(self.spec.name, SourceStatus.not_found)
        if resp.status_code == _RATE_LIMITED:
            self._cool_down(resp.headers.get("retry-after"))
            raise UpstreamFailure(self.spec.name, SourceStatus.rate_limited)
        if resp.status_code >= HTTP_CLIENT_ERROR_MIN:
            raise UpstreamFailure(self.spec.name, SourceStatus.unavailable, str(resp.status_code))
        try:
            data = orjson.loads(resp.content)
        except orjson.JSONDecodeError as exc:
            raise UpstreamFailure(self.spec.name, "decode") from exc
        return data, self.source_ref(SourceStatus.ok, url=str(resp.url), latency_ms=latency)

    def _cool_down(self, retry_after: str | None) -> None:
        """Stop calling an upstream that answered 429 (e.g. OpenAlex's daily budget) for as long as it asks."""
        wait = float(retry_after) if retry_after and retry_after.isdigit() else RATE_COOLDOWN_DEFAULT_S
        self._cooldown_until = time.monotonic() + min(wait, RATE_COOLDOWN_MAX_S)
        log.warning("upstream_rate_limited", upstream=self.spec.name, cooldown_s=min(wait, RATE_COOLDOWN_MAX_S))

    def source_ref(self, status: SourceStatus, **kwargs: Any) -> SourceRef:
        return SourceRef(
            name=self.spec.name,
            status=status,
            licence=self.spec.licence,
            attribution=self.spec.attribution,
            **kwargs,
        )


def storage_for(spec: UpstreamSpec) -> Storage:
    """Shared quotas live in Redis (api + worker); everything else is per-process."""
    redis_url = get_settings().redis_url
    if spec.shared_quota and redis_url:
        return RedisStorage(redis_url, implementation="redispy")
    return MemoryStorage()
