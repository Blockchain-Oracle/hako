"""hako/weather (MET Norway cross-checked with NWS) and hako/fact (current Wikidata statements)."""

from pydantic import Field

from hako_core.contract.enums import SourceStatus
from hako_now.facts.models import FactRequest, FactResult
from hako_now.facts.service import get_fact
from hako_now.weather.models import WeatherRequest, WeatherResult
from hako_now.weather.service import get_weather
from hako_tools.connectors.hako.bridge import call_now, report
from hako_tools.connectors.hako.provider import HAKO
from hako_tools.constants import TTL_LIVE_S, TTL_PAGE_S
from hako_tools.framework import (
    LOCAL,
    STANDARD,
    Category,
    ProviderError,
    Render,
    RunContext,
    ToolInput,
    ToolOutput,
    tool,
)


class WeatherInput(ToolInput, WeatherRequest):
    """Coordinates (`lat` and `lon`) or a place name."""


class WeatherOutput(ToolOutput, WeatherResult):
    unavailable: list[str] = Field(default_factory=list)


@tool(
    provider=HAKO,
    slug="weather",
    name="Hako Cross-checked Weather",
    summary="Weather for the current hour anywhere from MET Norway, cross-checked with the US National Weather "
    "Service (and its alerts) inside the US.",
    description="Give coordinates or a place name (resolved through Wikidata). Returns the current-hour forecast "
    "from MET Norway (temperature °C, wind m/s and direction, humidity, next-hour precipitation, conditions); "
    "inside the US the NWS reading and any active alerts are added and the two temperatures compared (agree / "
    "minor_diff / conflict). It is a nowcast, not a station observation, and has no multi-day forecast: for "
    "that use openweather/forecast.",
    categories=(Category.weather,),
    render=Render.weather,
    price=STANDARD,  # MET Norway + NWS (and a geocode for place names)
    example={"place": "Chicago"},
    see_also=("openweather/current", "openweather/forecast", "hako/time"),
    cache_ttl_s=TTL_LIVE_S,
)
async def weather(inp: WeatherInput, ctx: RunContext) -> WeatherOutput:
    result, sources, unavailable = await call_now(get_weather(inp))
    missing = report(ctx, sources, unavailable, result.notes if result else ())
    if result is None:
        raise ProviderError("Neither MET Norway nor NWS answered right now; retry shortly")
    return WeatherOutput(**{**dict(result), "notes": []}, unavailable=missing)


class FactInput(ToolInput, FactRequest):
    """An entity (Wikidata QID or a name) and a property (PID or an alias such as 'capital')."""


class FactOutput(ToolOutput, FactResult):
    pass


@tool(
    provider=HAKO,
    slug="fact",
    name="Hako Current Fact",
    summary="The current value of a fact from Wikidata (who leads X, capital, population…), with start date and "
    "provenance.",
    description="Looks up one property of one entity on Wikidata, by id (Q30, P35) or by name and alias ('Japan', "
    "'head of government', 'head', 'CEO', 'capital', 'population'), and returns only the values that are "
    "current: preferred-rank statements without an end date, latest point in time first, each with its start "
    "date and unit. Counts the ended statements it left out, follows an office to its holder when the subject "
    "names an office, and links the Wikipedia article. One fact per call; for a prose summary use "
    "wikipedia/summary, for an open question use hako/answer.",
    categories=(Category.knowledge,),
    render=Render.json,
    price=LOCAL,
    example={"subject": "Japan", "property": "head of government"},
    see_also=("wikipedia/summary", "hako/answer"),
    cache_ttl_s=TTL_PAGE_S,
)
async def fact(inp: FactInput, ctx: RunContext) -> FactOutput:
    result, sources = await call_now(get_fact(inp))
    report(ctx, sources, [s.name for s in sources if s.status is SourceStatus.unavailable])
    return FactOutput(**dict(result))
