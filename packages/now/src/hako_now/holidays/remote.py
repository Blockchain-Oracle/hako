"""Nager.Date and OpenHolidays: independent public-holiday lists to cross-check the offline calendar."""

from functools import cache
from typing import Any

from hako_core.cache.keys import cache_key
from hako_core.cache.store import cache as store
from hako_core.http.client import UpstreamClient
from hako_now import clients
from hako_now.constants import NAGER, OPENHOLIDAYS, TTL_HOLIDAYS

nager_client = cache(lambda: UpstreamClient(NAGER))
openholidays_client = cache(lambda: UpstreamClient(OPENHOLIDAYS))
clients.register(nager_client, openholidays_client)

LOCAL_SCOPE = "Local"


async def _cached(key: str, fetch: Any) -> Any:
    if (hit := await store.get(key)) is not None:
        return hit
    value = await fetch()
    await store.set(key, value, TTL_HOLIDAYS)
    return value


async def nager(country: str, year: int, subdivision: str | None) -> dict[str, tuple[str, bool]]:
    """date → (name, local_only) for public holidays that apply nationwide or to the subdivision."""

    async def fetch() -> list[dict[str, Any]]:
        data, _ = await nager_client().get_json(f"/api/v3/PublicHolidays/{year}/{country.upper()}")
        return data if isinstance(data, list) else []

    rows = await _cached(cache_key("now", "nager", "holidays", f"{country}:{year}"), fetch)
    region = f"{country.upper()}-{subdivision.upper()}" if subdivision else None
    out: dict[str, tuple[str, bool]] = {}
    for h in rows:
        if "Public" not in (h.get("types") or []):
            continue
        if h.get("global") or (region and region in (h.get("counties") or [])):
            out.setdefault(h["date"], (h.get("name") or h.get("localName") or "", False))
    return out


async def openholidays(country: str, year: int, subdivision: str | None) -> dict[str, tuple[str, bool]]:
    region = f"{country.upper()}-{subdivision.upper()}" if subdivision else None

    async def fetch() -> list[dict[str, Any]]:
        sub = f"&subdivisionCode={region}" if region else ""
        data, _ = await openholidays_client().get_json(
            f"/PublicHolidays?countryIsoCode={country.upper()}{sub}"
            f"&validFrom={year}-01-01&validTo={year}-12-31&languageIsoCode=EN"
        )
        return data if isinstance(data, list) else []

    rows = await _cached(cache_key("now", "openholidays", "holidays", f"{country}:{year}:{region}"), fetch)
    out: dict[str, tuple[str, bool]] = {}
    for h in rows:
        if not (h.get("nationwide") or region):
            continue
        name = next((n["text"] for n in h.get("name", []) if n.get("language") == "EN"), "")
        out.setdefault(h["startDate"], (name, h.get("regionalScope") == LOCAL_SCOPE))
    return out


async def openholidays_countries() -> frozenset[str]:
    async def fetch() -> list[str]:
        data, _ = await openholidays_client().get_json("/Countries")
        return [c["isoCode"] for c in data] if isinstance(data, list) else []

    return frozenset(await _cached(cache_key("now", "openholidays", "countries", "all"), fetch))
