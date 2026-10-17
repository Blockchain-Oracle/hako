"""OpenWeather geocoding: a place name → candidate coordinates."""

from pydantic import Field

from hako_tools.connectors.openweather.common import (
    CITY_MAX_CHARS,
    CITY_MIN_CHARS,
    GEOCODE_LIMIT_MAX,
    Location,
    geocode,
)
from hako_tools.connectors.openweather.provider import OPENWEATHER
from hako_tools.constants import TTL_REFERENCE_S
from hako_tools.framework import STANDARD, Category, Render, RunContext, ToolInput, ToolOutput, tool


class GeocodeInput(ToolInput):
    query: str = Field(min_length=CITY_MIN_CHARS, max_length=CITY_MAX_CHARS,
                       description="City or town, optionally ',<state>,<country code>': 'Springfield', "
                       "'Springfield,IL,US', 'Lagos,NG'.")
    limit: int = Field(GEOCODE_LIMIT_MAX, ge=1, le=GEOCODE_LIMIT_MAX, description="Candidates to return.")


class GeocodeOutput(ToolOutput):
    query: str
    places: list[Location]


@tool(
    provider=OPENWEATHER,
    slug="geocode",
    name="OpenWeather Geocoding",
    summary="Turn a city or town name into latitude/longitude candidates with state and country.",
    description="Looks up populated places by name and returns up to 5 candidates with latitude, longitude, "
    "state and ISO country code, so you can disambiguate 'Springfield' before asking for weather. Cities, "
    "towns and districts only: not street addresses, businesses or landmarks (use serper/places for those). "
    "No match comes back as found: false.",
    categories=(Category.places,),
    render=Render.place,
    price=STANDARD,
    example={"query": "Springfield", "limit": 3},
    see_also=("openweather/current", "serper/places"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def geocode_city(inp: GeocodeInput, ctx: RunContext) -> GeocodeOutput:
    return GeocodeOutput(query=inp.query, places=await geocode(ctx, inp.query, inp.limit))
