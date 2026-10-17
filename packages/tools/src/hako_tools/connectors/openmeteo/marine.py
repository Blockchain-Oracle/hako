"""Open-Meteo marine forecast: waves and swell now and per day (sea points only)."""

from pydantic import Field

from hako_tools.connectors.openmeteo.common import Location, PlaceInput, at, locate, resolved
from hako_tools.connectors.openmeteo.provider import OPEN_METEO, OPEN_METEO_MARINE
from hako_tools.constants import TTL_FORECAST_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolNotFoundResult, ToolOutput, tool

MARINE_DAYS_DEFAULT = 5
MARINE_DAYS_MAX = 8  # the marine API's limit
CURRENT_VARS = "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,sea_surface_temperature"
DAILY_VARS = "wave_height_max,wave_direction_dominant,wave_period_max,swell_wave_height_max"


class MarineInput(PlaceInput):
    days: int = Field(MARINE_DAYS_DEFAULT, ge=1, le=MARINE_DAYS_MAX, description="Days ahead, 1-8.")


class SeaNow(ToolOutput):
    observed_at: str | None = None
    wave_height_m: float | None = None
    wave_direction_deg: int | None = None
    wave_period_s: float | None = None
    swell_height_m: float | None = None
    swell_period_s: float | None = None
    sea_surface_temp_c: float | None = None


class SeaDay(ToolOutput):
    date: str
    wave_height_max_m: float | None = None
    wave_direction_deg: int | None = None
    wave_period_max_s: float | None = None
    swell_height_max_m: float | None = None


class MarineOutput(ToolOutput):
    location: Location
    current: SeaNow
    rows: list[SeaDay] = Field(description="One row per local day.")


@tool(
    provider=OPEN_METEO,
    slug="marine",
    name="Open-Meteo Marine Forecast",
    summary="Wave height, period and direction plus swell and sea temperature, now and for up to 8 days.",
    description="Sea state for a coastal place or ocean coordinates: significant wave height, wave direction and "
    "period, swell height and period and sea-surface temperature now, then daily maxima for up to 8 days. "
    "Good for surf, sailing, ferries and beach plans. A place name is geocoded to its town centre and the "
    "nearest sea grid cell is used; an inland point has no sea data and answers not found, so pass "
    "coordinates just offshore if needed. For weather on land use open-meteo/forecast.",
    categories=(Category.weather,),
    render=Render.table,
    price=LOCAL,
    example={"lat": -33.89, "lon": 151.28, "days": 3},
    see_also=("open-meteo/forecast",),
    cache_ttl_s=TTL_FORECAST_S,
)
async def marine(inp: MarineInput, ctx: RunContext) -> MarineOutput:
    location = await locate(ctx, inp)
    data = await ctx.get_json(OPEN_METEO_MARINE, "/v1/marine", params={
        "latitude": location.lat, "longitude": location.lon, "timezone": "auto", "forecast_days": inp.days,
        "current": CURRENT_VARS, "daily": DAILY_VARS})
    now = data.get("current") or {}
    daily = data.get("daily") or {}
    rows = [SeaDay(date=d, wave_height_max_m=at(daily, "wave_height_max", i),
                   wave_direction_deg=at(daily, "wave_direction_dominant", i),
                   wave_period_max_s=at(daily, "wave_period_max", i),
                   swell_height_max_m=at(daily, "swell_wave_height_max", i))
            for i, d in enumerate(daily.get("time") or [])]
    rows = [r for r in rows if r.wave_height_max_m is not None]
    if not rows and now.get("wave_height") is None:
        raise ToolNotFoundResult("no sea data at that point (it is on land); try coordinates just offshore")
    return MarineOutput(
        location=resolved(location, data),
        current=SeaNow(observed_at=now.get("time"), wave_height_m=now.get("wave_height"),
                       wave_direction_deg=now.get("wave_direction"), wave_period_s=now.get("wave_period"),
                       swell_height_m=now.get("swell_wave_height"), swell_period_s=now.get("swell_wave_period"),
                       sea_surface_temp_c=now.get("sea_surface_temperature")),
        rows=rows)
