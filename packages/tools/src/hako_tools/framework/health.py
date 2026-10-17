"""Endpoint health from our own runs: a verdict plus p50/p95 run time, shown as e.g. `healthy 4.4s`.

Samples live in Redis (shared by the api and the probe task) and fall back to process memory without it.
"""

import asyncio
import statistics
import time
from collections import deque
from enum import StrEnum
from typing import Any

import structlog
from redis.asyncio import Redis

from hako_core.settings import get_settings
from hako_tools.constants import (
    HEALTH_DEGRADED_RATE,
    HEALTH_KEY_PREFIX,
    HEALTH_OUTAGE_STREAK,
    HEALTH_P50,
    HEALTH_P95,
    HEALTH_RECENT_S,
    HEALTH_REDIS_CONNECT_S,
    HEALTH_REDIS_TIMEOUT_S,
    HEALTH_SAMPLES,
    HEALTH_STABLE_MIN_RUNS,
    HEALTH_STABLE_RATE,
)

log = structlog.get_logger(__name__)
_PERCENT = 100


class HealthStatus(StrEnum):
    healthy = "healthy"
    stable = "stable"
    degraded = "degraded"
    outage = "outage"
    unknown = "unknown"


Sample = tuple[float, bool, int]  # (unix time, ok, latency ms)


def _encode(sample: Sample) -> str:
    ts, ok, latency = sample
    return f"{ts:.0f}:{int(ok)}:{latency}"


def _decode(raw: bytes | str) -> Sample:
    text = raw.decode() if isinstance(raw, bytes) else raw
    ts, ok, latency = text.split(":")
    return float(ts), ok == "1", int(latency)


def _quantile(values: list[int], q: float) -> int | None:
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    return round(statistics.quantiles(values, n=_PERCENT, method="inclusive")[round(q * _PERCENT) - 1])


def verdict(samples: list[Sample], now: float) -> dict[str, Any]:
    """samples are newest first."""
    runs = len(samples)
    if runs == 0:
        return {"status": HealthStatus.unknown, "runs": 0, "successRate": None, "p50Ms": None, "p95Ms": None}
    oks = [s for s in samples if s[1]]
    rate = len(oks) / runs
    streak = next((i for i, s in enumerate(samples) if s[1]), runs)
    latencies = [s[2] for s in oks]
    if streak >= HEALTH_OUTAGE_STREAK:
        status = HealthStatus.outage
    elif rate < HEALTH_DEGRADED_RATE:
        status = HealthStatus.degraded
    elif oks and now - oks[0][0] <= HEALTH_RECENT_S:
        status = HealthStatus.healthy
    elif runs >= HEALTH_STABLE_MIN_RUNS and rate >= HEALTH_STABLE_RATE:
        status = HealthStatus.stable
    else:
        status = HealthStatus.unknown
    return {
        "status": status,
        "runs": runs,
        "successRate": round(rate, 3),
        "p50Ms": _quantile(latencies, HEALTH_P50),
        "p95Ms": _quantile(latencies, HEALTH_P95),
        "lastOkAt": round(oks[0][0]) if oks else None,
    }


class HealthStore:
    def __init__(self) -> None:
        self._memory: dict[str, deque[Sample]] = {}
        self._redis: Redis | None = None
        self._configured = False
        self._pending: set[asyncio.Task[None]] = set()

    def _client(self) -> Redis | None:
        if not self._configured:
            url = get_settings().redis_url
            self._redis = (
                Redis.from_url(
                    url, socket_connect_timeout=HEALTH_REDIS_CONNECT_S, socket_timeout=HEALTH_REDIS_TIMEOUT_S
                )
                if url
                else None
            )
            self._configured = True
        return self._redis

    async def record(self, endpoint_id: str, ok: bool, latency_ms: int) -> None:
        """Memory now; Redis in the background, so a run never waits on bookkeeping."""
        sample = (time.time(), ok, latency_ms)
        self._memory.setdefault(endpoint_id, deque(maxlen=HEALTH_SAMPLES)).appendleft(sample)
        if self._client() is None:
            return
        task = asyncio.create_task(self._persist(endpoint_id, sample))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _persist(self, endpoint_id: str, sample: Sample) -> None:
        redis = self._client()
        if redis is None:
            return
        key = f"{HEALTH_KEY_PREFIX}:{endpoint_id}"
        try:
            async with redis.pipeline(transaction=False) as pipe:
                pipe.lpush(key, _encode(sample))
                pipe.ltrim(key, 0, HEALTH_SAMPLES - 1)
                await pipe.execute()
        except Exception:
            log.warning("health_record_failed", endpoint=endpoint_id)

    async def snapshots(self, endpoint_ids: list[str]) -> dict[str, dict[str, Any]]:
        now = time.time()
        samples: dict[str, list[Sample]] = {i: list(self._memory.get(i, ())) for i in endpoint_ids}
        redis = self._client()
        if redis is not None and endpoint_ids:
            try:
                async with redis.pipeline(transaction=False) as pipe:
                    for i in endpoint_ids:
                        pipe.lrange(f"{HEALTH_KEY_PREFIX}:{i}", 0, HEALTH_SAMPLES - 1)
                    rows = await pipe.execute()
                samples = {i: [_decode(r) for r in row] for i, row in zip(endpoint_ids, rows, strict=True)}
            except Exception:
                log.warning("health_read_failed")
        return {i: verdict(s, now) for i, s in samples.items()}

    async def close(self) -> None:
        if self._pending:
            await asyncio.gather(*self._pending, return_exceptions=True)
        if self._redis is not None:
            await self._redis.aclose()


health = HealthStore()
