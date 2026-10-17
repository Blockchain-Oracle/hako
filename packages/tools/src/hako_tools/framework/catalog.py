"""The compiled catalog: every provider and endpoint as JSON, with a content hash for caching."""

import hashlib
from functools import lru_cache
from typing import Any

import orjson

from hako_tools.categories import CATEGORY_LABELS
from hako_tools.constants import CATALOG_VERSION, PAYMENT_NETWORK, SERVICE_ID, SERVICE_TITLE
from hako_tools.framework.endpoint import REGISTRY, Endpoint
from hako_tools.framework.provider import Provider

_HASH_CHARS = 16


def endpoints() -> list[Endpoint]:
    return sorted(REGISTRY.values(), key=lambda e: e.id)


def providers() -> list[Provider]:
    seen: dict[str, Provider] = {}
    for e in endpoints():
        seen.setdefault(e.provider.id, e.provider)
    return sorted(seen.values(), key=lambda p: p.display_name.lower())


@lru_cache(maxsize=1)
def compiled() -> dict[str, Any]:
    """Built once per process: the registry is fixed after import, and credentials do not change at runtime."""
    eps = endpoints()
    counts: dict[str, int] = {}
    for e in eps:
        counts[e.provider.id] = counts.get(e.provider.id, 0) + 1
    category_counts: dict[str, int] = {}
    for e in eps:
        for c in e.categories:
            category_counts[c.value] = category_counts.get(c.value, 0) + 1
    body: dict[str, Any] = {
        "service": SERVICE_ID,
        "title": SERVICE_TITLE,
        "catalogVersion": CATALOG_VERSION,
        "network": PAYMENT_NETWORK,
        "categories": [
            {"id": c.value, "label": label, "endpointCount": category_counts.get(c.value, 0)}
            for c, label in CATEGORY_LABELS.items()
            if category_counts.get(c.value)
        ],
        "providers": [p.doc(counts[p.id]) for p in providers()],
        "endpoints": [e.doc() for e in eps],
    }
    body["hash"] = hashlib.sha256(orjson.dumps(body, option=orjson.OPT_SORT_KEYS)).hexdigest()[:_HASH_CHARS]
    return body


def inspect(endpoint_id: str) -> dict[str, Any] | None:
    endpoint = REGISTRY.get(endpoint_id)
    return endpoint.doc() if endpoint else None
