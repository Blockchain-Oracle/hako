"""Nominatim search (place or address → candidates) and reverse (coordinates → address)."""

from typing import Any

from pydantic import Field

from hako_tools.connectors.openstreetmap.provider import OPENSTREETMAP
from hako_tools.constants import TTL_REFERENCE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

QUERY_MIN_CHARS = 2
QUERY_MAX_CHARS = 200
LIMIT_DEFAULT = 5
LIMIT_MAX = 10
LAT_MAX = 90.0
LON_MAX = 180.0
COUNTRY_CODES_MAX_CHARS = 60
COORD_DECIMALS = 6
IMPORTANCE_DECIMALS = 3
STREET_ZOOM = 18  # Nominatim zoom: 18 = building/street, 10 = city, 3 = country
OSM_URL = "https://www.openstreetmap.org/{type}/{id}"
# Nominatim's address keys, from the most to the least local, that become the short `locality` line
LOCALITY_KEYS = ("city", "town", "village", "hamlet", "municipality", "suburb", "county")
# Extra tags worth passing on to an agent (opening hours, contact, links); the rest are mapping internals
EXTRA_TAGS = ("website", "phone", "opening_hours", "wikipedia", "wikidata", "cuisine", "height", "population")


class Place(ToolOutput):
    name: str | None = None
    address: str | None = None
    category: str | None = None
    type: str | None = None
    lat: float
    lon: float
    locality: str | None = None
    state: str | None = None
    postcode: str | None = None
    country: str | None = None
    country_code: str | None = None
    importance: float | None = None
    osm_url: str | None = None
    extra: dict[str, str] = Field(default_factory=dict)


def _place(row: dict[str, Any]) -> Place:
    address = row.get("address") or {}
    extras = row.get("extratags") or {}
    osm_type, osm_id = row.get("osm_type"), row.get("osm_id")
    importance = row.get("importance")
    return Place(
        name=row.get("name") or None, address=row.get("display_name"), category=row.get("category"),
        type=row.get("type"), lat=round(float(row["lat"]), COORD_DECIMALS), lon=round(float(row["lon"]),
                                                                                       COORD_DECIMALS),
        locality=next((address[k] for k in LOCALITY_KEYS if address.get(k)), None), state=address.get("state"),
        postcode=address.get("postcode"), country=address.get("country"),
        country_code=(address.get("country_code") or "").upper() or None,
        importance=round(importance, IMPORTANCE_DECIMALS) if isinstance(importance, int | float) else None,
        osm_url=OSM_URL.format(type=osm_type, id=osm_id) if osm_type and osm_id else None,
        extra={k: str(extras[k]) for k in EXTRA_TAGS if extras.get(k)})


class SearchInput(ToolInput):
    query: str = Field(min_length=QUERY_MIN_CHARS, max_length=QUERY_MAX_CHARS,
                       description="An address, landmark, business or place: '10 Downing Street, London', "
                       "'Eiffel Tower', 'Lekki Phase 1'.")
    country_codes: str | None = Field(None, max_length=COUNTRY_CODES_MAX_CHARS,
                                      description="Limit to ISO 3166-1 alpha-2 codes, comma-separated: 'ng,gh'.")
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX)


class SearchOutput(ToolOutput):
    query: str
    places: list[Place]


@tool(
    provider=OPENSTREETMAP,
    slug="geocode",
    name="OpenStreetMap Geocode",
    summary="Find an address, landmark or business on OpenStreetMap: coordinates, full address, type and links.",
    description="Searches OpenStreetMap through Nominatim for an address, a landmark, a business or any named "
    "place and returns up to 10 candidates, best first: name, full address, category and type (e.g. "
    "tourism/attraction, amenity/cafe), coordinates, locality, state, postcode, country, an importance score, "
    "the OpenStreetMap link and useful tags (website, phone, opening hours, Wikipedia). Narrow it with "
    "country_codes. Use the coordinates with open-meteo/forecast or openweather/current; for ratings and reviews "
    "use serper/places.",
    categories=(Category.places,),
    render=Render.place,
    price=LOCAL,
    example={"query": "Eiffel Tower", "limit": 2},
    see_also=("openstreetmap/reverse", "serper/places"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def geocode(inp: SearchInput, ctx: RunContext) -> SearchOutput:
    params: dict[str, Any] = {"q": inp.query, "format": "jsonv2", "limit": inp.limit, "addressdetails": 1,
                              "extratags": 1}
    if inp.country_codes:
        params["countrycodes"] = inp.country_codes.lower().replace(" ", "")
    rows = await ctx.get_json(OPENSTREETMAP, "/search", params=params) or []
    places = [_place(r) for r in rows if isinstance(r, dict) and "lat" in r and "lon" in r]
    if not places:
        raise ToolNotFoundResult(f"OpenStreetMap has no place matching {inp.query!r}")
    return SearchOutput(query=inp.query, places=places)


class ReverseInput(ToolInput):
    lat: float = Field(ge=-LAT_MAX, le=LAT_MAX)
    lon: float = Field(ge=-LON_MAX, le=LON_MAX)


@tool(
    provider=OPENSTREETMAP,
    slug="reverse",
    name="OpenStreetMap Reverse Geocode",
    summary="Turn coordinates into the nearest street address, neighbourhood, city, postcode and country.",
    description="Reverse geocoding: the OpenStreetMap object nearest to a latitude/longitude, with its name, full "
    "address, locality, state, postcode and country. Use it to say where a GPS point, a photo's coordinates or an "
    "earthquake epicentre is. Points at sea or far from any address answer not found. For the other direction "
    "(name → coordinates) use openstreetmap/geocode.",
    categories=(Category.places,),
    render=Render.place,
    price=LOCAL,
    example={"lat": 37.788, "lon": -122.4075},
    see_also=("openstreetmap/geocode",),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def reverse(inp: ReverseInput, ctx: RunContext) -> Place:
    row = await ctx.get_json(OPENSTREETMAP, "/reverse", params={
        "lat": inp.lat, "lon": inp.lon, "format": "jsonv2", "zoom": STREET_ZOOM, "addressdetails": 1, "extratags": 1})
    if not isinstance(row, dict) or "lat" not in row or row.get("error"):
        raise ToolNotFoundResult(f"no address near {inp.lat}, {inp.lon}")
    return _place(row)
