"""Frankfurter v2: the provider catalogue (daily cache) and one rates call per provider."""

from dataclasses import dataclass
from datetime import date
from functools import cache
from typing import Any

from hako_core.cache.keys import cache_key
from hako_core.cache.store import cache as store
from hako_core.http.client import UpstreamClient
from hako_now import clients
from hako_now.constants import FRANKFURTER, TTL_FX_PROVIDERS, TTL_FX_RATES

client = cache(lambda: UpstreamClient(FRANKFURTER))
clients.register(client)


@dataclass(frozen=True, slots=True)
class Provider:
    key: str
    name: str
    pivot: str
    country: str | None  # ISO 3166 alpha-2 of the issuing authority ("EU" for the ECB)
    currencies: frozenset[str]
    cadence: str | None
    rate_type: str | None

    def covers(self, code: str) -> bool:
        return code == self.pivot or code in self.currencies


async def providers() -> list[Provider]:
    key = cache_key("now", "frankfurter", "providers", "all")
    if (rows := await store.get(key)) is None:
        rows, _ = await client().get_json("/v2/providers")
        await store.set(key, rows, TTL_FX_PROVIDERS)
    return [
        Provider(
            r["key"],
            r.get("name", r["key"]),
            r.get("pivot_currency") or "",
            r.get("country_code"),
            frozenset(r.get("currencies") or []),
            r.get("publish_cadence"),
            r.get("rate_type"),
        )
        for r in rows
    ]


async def rates(provider: str, base: str, quotes: list[str], on: date | None) -> list[dict[str, Any]]:
    day = f"&date={on.isoformat()}" if on else ""
    path = f"/v2/rates?base={base}&quotes={','.join(quotes)}&providers={provider}{day}"
    key = cache_key("now", "frankfurter", "rates", path)
    if (hit := await store.get(key)) is None:
        hit, _ = await client().get_json(path)
        await store.set(key, hit, TTL_FX_RATES)
    return hit if isinstance(hit, list) else []
