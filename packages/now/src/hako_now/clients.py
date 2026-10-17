"""Process-wide upstream clients for Hako's own computations (created lazily)."""

from functools import cache

from hako_core.http.client import UpstreamClient
from hako_now.constants import IANA, WIKIDATA_API

iana = cache(lambda: UpstreamClient(IANA))
wikidata = cache(lambda: UpstreamClient(WIKIDATA_API))

_ALL = [iana, wikidata]


def register(*factories: object) -> None:
    """Feature modules add their clients so close_all() reaches them."""
    _ALL.extend(factories)  # type: ignore[arg-type]


async def close_all() -> None:
    for factory in _ALL:
        if factory.cache_info().currsize:  # type: ignore[attr-defined]
            await factory().aclose()  # type: ignore[operator]
