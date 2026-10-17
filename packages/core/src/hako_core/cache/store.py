"""Thin async cache facade over cashews. Redis errors degrade to cache misses, never to failures."""

from datetime import timedelta
from typing import Any

import structlog
from cashews import Cache

from hako_core.cache.codec import decode, encode
from hako_core.constants.cache import REDIS_SOCKET_CONNECT_TIMEOUT_S

log = structlog.get_logger(__name__)
_FOREVER = None  # no TTL: evicted only by Redis LRU (immutable data such as package versions)


class CacheStore:
    def __init__(self) -> None:
        self._cache = Cache()
        self.enabled = False

    def setup(self, redis_url: str | None) -> None:
        if not redis_url:
            self._cache.setup("mem://")  # local dev / single-process fallback
        else:
            self._cache.setup(redis_url, socket_connect_timeout=REDIS_SOCKET_CONNECT_TIMEOUT_S, suppress=True)
        self.enabled = True

    async def get(self, key: str) -> Any | None:
        if not self.enabled:
            return None
        try:
            blob = await self._cache.get(key)
        except Exception:
            log.warning("cache_get_failed", key=key)
            return None
        return decode(blob) if blob is not None else None

    async def set(self, key: str, value: Any, ttl: timedelta | None = _FOREVER) -> None:
        if not self.enabled:
            return
        try:
            await self._cache.set(key, encode(value), expire=ttl)
        except Exception:
            log.warning("cache_set_failed", key=key)

    async def close(self) -> None:
        if self.enabled:
            await self._cache.close()


cache = CacheStore()
