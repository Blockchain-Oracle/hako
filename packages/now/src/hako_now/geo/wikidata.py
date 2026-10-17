"""Place name → coordinates and ISO country via Wikidata.

Search ranks "New York" the state above New York City, and "Washington" the state above Washington, D.C. So among
the hits that have coordinates and whose label is the query, or the query followed by more ("New York City"),
the most notable one wins: the one with the most Wikipedia sitelinks. New York → New York City, Washington →
Washington, D.C., Paris → Paris (France), Georgia → the country (348 sitelinks against the US state's 231),
Mexico → the country. With no such label, the first hit with coordinates in search order.

Three small calls: the search, one `action=query` for every candidate's primary coordinates and sitelink count
(about 1 KB for eight candidates; whole entities were 1.6 MB and 4 s), and the chosen place's country claim.
"""

import json
from dataclasses import asdict, dataclass
from functools import lru_cache
from importlib import resources
from typing import Any
from urllib.parse import quote

from hako_core.cache.keys import cache_key
from hako_core.cache.store import cache
from hako_now import clients
from hako_now.constants import (
    GEOCODE_CACHE_KIND,
    GEOCODE_CANDIDATES,
    PLACE_NAME_SEPARATORS,
    TTL_GEOCODE,
    WIKIDATA_COUNTRY,
)

EARTH = "earth"


@dataclass(frozen=True, slots=True)
class Place:
    qid: str
    label: str
    description: str | None
    lat: float
    lon: float
    country: str | None  # ISO 3166-1 alpha-2


@lru_cache(maxsize=1)
def _country_iso() -> dict[str, str]:
    """Wikidata country QID → ISO 3166-1 alpha-2 (P297), bundled so geocoding needs two calls, not three.

    Generated 2026-09-29 with SPARQL `SELECT DISTINCT ?c ?iso WHERE { ?c wdt:P297 ?iso . }` (261 entries, CC0).
    """
    return json.loads(resources.files("hako_now.data").joinpath("wikidata_country_iso.json").read_text())


def _value(claims: dict[str, Any], prop: str) -> Any:
    for claim in claims.get(prop, []):
        if claim.get("rank") != "deprecated" and (snak := claim.get("mainsnak", {})).get("datavalue"):
            return snak["datavalue"]["value"]
    return None


@dataclass(frozen=True, slots=True)
class _Candidate:
    lat: float
    lon: float
    sitelinks: int


async def _candidates(ids: list[str]) -> dict[str, _Candidate]:
    """Primary coordinates (from P625) and the sitelink count of every candidate that has coordinates on Earth."""
    data, _ = await clients.wikidata().get_json(
        f"/w/api.php?action=query&titles={'|'.join(ids)}&prop=coordinates|pageprops&ppprop=wb-sitelinks"
        "&format=json&formatversion=2"
    )
    out: dict[str, _Candidate] = {}
    for page in data.get("query", {}).get("pages", []):
        coords = page.get("coordinates") or []
        primary = next((c for c in coords if c.get("primary")), coords[0] if coords else None)
        if primary and primary.get("globe", EARTH) == EARTH:
            links = int((page.get("pageprops") or {}).get("wb-sitelinks", 0))
            out[page["title"]] = _Candidate(primary["lat"], primary["lon"], links)
    return out


async def _country(qid: str) -> str | None:
    data, _ = await clients.wikidata().get_json(
        f"/w/api.php?action=wbgetclaims&entity={qid}&property={WIKIDATA_COUNTRY}&format=json"
    )
    ref = _value(data.get("claims", {}), WIKIDATA_COUNTRY)
    return _country_iso().get(ref["id"]) if ref else None


def _names_the_place(label: str, wanted: str) -> bool:
    """The label is the query, or the query followed by more words ("New York City", "Washington, D.C.")."""
    name = label.casefold()
    return name == wanted or (name.startswith(wanted) and name[len(wanted) : len(wanted) + 1] in PLACE_NAME_SEPARATORS)


def _pick(hits: list[dict[str, Any]], located: dict[str, _Candidate], wanted: str) -> dict[str, Any] | None:
    placed = [h for h in hits if h["id"] in located]
    named = [h for h in placed if _names_the_place(h.get("label") or "", wanted)]
    if not named:
        return placed[0] if placed else None
    # max() keeps the first of equals, so search order breaks ties
    return max(named, key=lambda h: located[h["id"]].sitelinks)


async def geocode(place: str) -> Place | None:
    key = cache_key("now", "wikidata", GEOCODE_CACHE_KIND, place.lower())
    if (hit := await cache.get(key)) is not None:
        return Place(**hit) if hit else None
    found, _ = await clients.wikidata().get_json(
        f"/w/api.php?action=wbsearchentities&search={quote(place)}&language=en&type=item"
        f"&limit={GEOCODE_CANDIDATES}&format=json"
    )
    hits = found.get("search", [])
    result: Place | None = None
    if hits:
        located = await _candidates([h["id"] for h in hits])
        if (h := _pick(hits, located, place.strip().casefold())) is not None:
            at, country = located[h["id"]], await _country(h["id"])
            result = Place(h["id"], h.get("label", place), h.get("description"), at.lat, at.lon, country)
    await cache.set(key, asdict(result) if result else {}, TTL_GEOCODE)
    return result
