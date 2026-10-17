"""usgs/earthquakes: the CDN-cached summary feeds for worldwide queries, the FDSN service for 'near a point'."""

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Self

from pydantic import Field, model_validator

from hako_tools.connectors.usgs.provider import USGS
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolOutput, tool

LIMIT_DEFAULT = 10
LIMIT_MAX = 50
MAG_DEFAULT = 2.5
MAG_MAX = 10.0
RADIUS_DEFAULT_KM = 300.0
RADIUS_MAX_KM = 20_001.6  # half the Earth's circumference: the FDSN service's own ceiling
LAT_MAX = 90.0
LON_MAX = 180.0
_MS_PER_S = 1000
# Summary feeds exist for these magnitude floors (earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php).
FEED_FLOORS: tuple[tuple[float, str], ...] = ((4.5, "4.5"), (2.5, "2.5"), (1.0, "1.0"))
FEED_ALL = "all"


class Period(StrEnum):
    hour = "hour"
    day = "day"
    week = "week"
    month = "month"


_SPAN = {Period.hour: timedelta(hours=1), Period.day: timedelta(days=1), Period.week: timedelta(days=7),
         Period.month: timedelta(days=30)}


class Order(StrEnum):
    newest = "newest"
    strongest = "strongest"


class QuakesInput(ToolInput):
    period: Period = Field(Period.day, description="How far back: the past hour, day, week or 30 days.")
    min_magnitude: float = Field(MAG_DEFAULT, ge=0, le=MAG_MAX)
    latitude: float | None = Field(None, ge=-LAT_MAX, le=LAT_MAX, description="Centre of a search circle.")
    longitude: float | None = Field(None, ge=-LON_MAX, le=LON_MAX)
    radius_km: float = Field(RADIUS_DEFAULT_KM, gt=0, le=RADIUS_MAX_KM, description="Circle radius around the point.")
    order: Order = Field(Order.newest)
    limit: int = Field(LIMIT_DEFAULT, ge=1, le=LIMIT_MAX)

    @model_validator(mode="after")
    def _point(self) -> Self:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("give both latitude and longitude, or neither for worldwide")
        return self


class Quake(ToolOutput):
    id: str
    time: str
    magnitude: float | None = None
    magnitude_type: str | None = None
    place: str | None = None
    depth_km: float | None = None
    latitude: float | None = None
    longitude: float | None = None
    tsunami: bool = False  # the event is in a region where a tsunami alert may have been issued
    alert: str | None = None  # PAGER impact level: green, yellow, orange, red
    felt: int | None = None  # "Did You Feel It?" reports
    url: str | None = None


class QuakesOutput(ToolOutput):
    period: Period
    min_magnitude: float
    total: int | None = None  # quakes matching the filters (None when the limit cut a point search short)
    rows: list[Quake]


def _quake(feature: dict[str, Any]) -> Quake:
    p = feature.get("properties") or {}
    coords = ((feature.get("geometry") or {}).get("coordinates") or []) + [None, None, None]
    when = datetime.fromtimestamp((p.get("time") or 0) / _MS_PER_S, tz=UTC)
    return Quake(
        id=str(feature.get("id", "")),
        time=when.isoformat(timespec="seconds"),
        magnitude=p.get("mag"),
        magnitude_type=p.get("magType"),
        place=p.get("place"),
        depth_km=coords[2],
        latitude=coords[1],
        longitude=coords[0],
        tsunami=bool(p.get("tsunami")),
        alert=p.get("alert"),
        felt=p.get("felt"),
        url=p.get("url"),
    )


def _feed(min_magnitude: float, period: Period) -> str:
    floor = next((name for value, name in FEED_FLOORS if min_magnitude >= value), FEED_ALL)
    return f"/earthquakes/feed/v1.0/summary/{floor}_{period.value}.geojson"


def _sort(quakes: list[Quake], order: Order) -> list[Quake]:
    if order is Order.strongest:
        return sorted(quakes, key=lambda q: q.magnitude or 0, reverse=True)
    return sorted(quakes, key=lambda q: q.time, reverse=True)


@tool(
    provider=USGS,
    slug="earthquakes",
    name="USGS Recent Earthquakes",
    summary="Recent earthquakes worldwide or within a radius of a point: magnitude, place, time, depth, tsunami flag.",
    description="Lists earthquakes from the USGS real-time catalogue for the past hour, day, week or 30 days, above "
    "a minimum magnitude, newest or strongest first; give latitude/longitude (and radius_km) to search around a "
    "place. Each row has UTC time, magnitude, place, depth, coordinates, the tsunami flag, PAGER alert level and the "
    "USGS event page. Coverage is global for M4.5+, and dense for smaller quakes mainly in the US. It does not "
    "forecast quakes or issue tsunami warnings; check official agencies for those.",
    categories=(Category.weather, Category.science),
    render=Render.table,
    price=LOCAL,
    example={"period": "day", "min_magnitude": 4.5, "limit": 10},
    see_also=("openweather/current", "wikipedia/summary"),
    cache_ttl_s=TTL_LIVE_S,
)
async def earthquakes(inp: QuakesInput, ctx: RunContext) -> QuakesOutput:
    if inp.latitude is None and inp.period is not Period.month:
        data = await ctx.get_json(USGS, _feed(inp.min_magnitude, inp.period))
        quakes = [q for q in map(_quake, data.get("features") or []) if (q.magnitude or 0) >= inp.min_magnitude]
        return QuakesOutput(period=inp.period, min_magnitude=inp.min_magnitude, total=len(quakes),
                            rows=_sort(quakes, inp.order)[: inp.limit])
    start = datetime.now(UTC) - _SPAN[inp.period]
    params: dict[str, Any] = {
        "format": "geojson",
        "starttime": start.strftime("%Y-%m-%dT%H:%M:%S"),
        "minmagnitude": inp.min_magnitude,
        "limit": inp.limit,
        "orderby": "magnitude" if inp.order is Order.strongest else "time",
    }
    if inp.latitude is not None:
        params.update(latitude=inp.latitude, longitude=inp.longitude, maxradiuskm=inp.radius_km)
    data = await ctx.get_json(USGS, "/fdsnws/event/1/query", params=params)
    quakes = [_quake(f) for f in data.get("features") or []]
    return QuakesOutput(period=inp.period, min_magnitude=inp.min_magnitude,
                        total=len(quakes) if len(quakes) < inp.limit else None, rows=quakes)
