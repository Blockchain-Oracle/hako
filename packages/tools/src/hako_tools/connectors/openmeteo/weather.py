"""Open-Meteo forecast (current + up to 16 days) and weather history (any day since 1940)."""

from datetime import UTC, date, datetime, timedelta
from typing import Self

from pydantic import Field, model_validator

from hako_tools.connectors.openmeteo.common import (
    UNIT_LABELS,
    UNIT_PARAMS,
    DayWeather,
    Location,
    PlaceInput,
    UnitLabels,
    Units,
    days,
    describe,
    locate,
    resolved,
)
from hako_tools.connectors.openmeteo.provider import OPEN_METEO, OPEN_METEO_ARCHIVE
from hako_tools.constants import TTL_FORECAST_S, TTL_REFERENCE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolNotFoundResult, ToolOutput, tool

FORECAST_DAYS_DEFAULT = 7
FORECAST_DAYS_MAX = 16  # the forecast API's limit
HISTORY_SPAN_MAX_DAYS = 31  # one month per call keeps the answer small
HISTORY_EARLIEST = date(1940, 1, 1)  # ERA5 starts here
# The forecast API also serves the recent past (up to 92 days back) without the archive's ~5-day lag.
FORECAST_PAST_DAYS_MAX = 92

CURRENT_VARS = ("temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,"
                "pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m")
FORECAST_DAILY_VARS = ("weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,"
                       "precipitation_probability_max,wind_speed_10m_max,uv_index_max,sunrise,sunset")
HISTORY_DAILY_VARS = ("weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,"
                      "wind_speed_10m_max,sunrise,sunset")


class ForecastInput(PlaceInput):
    days: int = Field(FORECAST_DAYS_DEFAULT, ge=1, le=FORECAST_DAYS_MAX, description="Days ahead, 1-16.")
    units: Units = Field(Units.metric, description="metric (°C, m/s, mm) or imperial (°F, mph, inch).")


class Conditions(ToolOutput):
    observed_at: str | None = None
    description: str | None = None
    temp: float | None = None
    feels_like: float | None = None
    humidity_pct: int | None = None
    precipitation: float | None = None
    clouds_pct: int | None = None
    pressure_hpa: float | None = None
    wind_speed: float | None = None
    wind_gust: float | None = None
    wind_deg: int | None = None


class ForecastOutput(ToolOutput):
    location: Location
    units: UnitLabels
    current: Conditions
    days: list[DayWeather] = Field(description="One row per local calendar day, today first.")


@tool(
    provider=OPEN_METEO,
    slug="forecast",
    name="Open-Meteo 16-Day Forecast",
    summary="Weather now plus a daily forecast up to 16 days ahead for any place: highs, lows, rain chance, wind, UV.",
    description="Current conditions and a day-by-day forecast (1-16 days) from Open-Meteo's blend of national "
    "weather models, for a place name or coordinates. Each day has the condition, min/max temperature, total "
    "precipitation, the highest chance of precipitation, max wind, max UV index, sunrise and sunset in local time. "
    "Use it for trips and plans beyond a few days; for hourly detail over the next 5 days use "
    "openweather/forecast, and for past days use open-meteo/history.",
    categories=(Category.weather,),
    render=Render.weather,
    price=LOCAL,
    example={"place": "Lagos", "country_code": "NG", "days": 5},
    see_also=("open-meteo/history", "openweather/forecast", "openweather/current"),
    cache_ttl_s=TTL_FORECAST_S,
)
async def forecast(inp: ForecastInput, ctx: RunContext) -> ForecastOutput:
    location = await locate(ctx, inp)
    data = await ctx.get_json(OPEN_METEO, "/v1/forecast", params={
        "latitude": location.lat, "longitude": location.lon, "timezone": "auto", "forecast_days": inp.days,
        "current": CURRENT_VARS, "daily": FORECAST_DAILY_VARS, **UNIT_PARAMS[inp.units]})
    now = data.get("current") or {}
    return ForecastOutput(
        location=resolved(location, data), units=UNIT_LABELS[inp.units],
        current=Conditions(
            observed_at=now.get("time"), description=describe(now.get("weather_code")),
            temp=now.get("temperature_2m"), feels_like=now.get("apparent_temperature"),
            humidity_pct=now.get("relative_humidity_2m"), precipitation=now.get("precipitation"),
            clouds_pct=now.get("cloud_cover"), pressure_hpa=now.get("pressure_msl"),
            wind_speed=now.get("wind_speed_10m"), wind_gust=now.get("wind_gusts_10m"),
            wind_deg=now.get("wind_direction_10m")),
        days=days(data.get("daily") or {}))


class HistoryInput(PlaceInput):
    start_date: date = Field(description="First day, YYYY-MM-DD, from 1940-01-01.")
    end_date: date | None = Field(None, description="Last day (default: start_date), at most 31 days after it.")
    units: Units = Field(Units.metric, description="metric (°C, m/s, mm) or imperial (°F, mph, inch).")

    @model_validator(mode="after")
    def _range(self) -> Self:
        end = self.end_date or self.start_date
        if self.start_date < HISTORY_EARLIEST:
            raise ValueError("history starts on 1940-01-01")
        if end < self.start_date:
            raise ValueError("end_date is before start_date")
        if (end - self.start_date).days >= HISTORY_SPAN_MAX_DAYS:
            raise ValueError(f"at most {HISTORY_SPAN_MAX_DAYS} days per call")
        return self


class HistoryOutput(ToolOutput):
    location: Location
    units: UnitLabels
    dataset: str = Field(description="'era5' reanalysis, or 'recent' (archived forecasts for the last 92 days).")
    days: list[DayWeather]


@tool(
    provider=OPEN_METEO,
    slug="history",
    name="Open-Meteo Weather History",
    summary="What the weather was on any day since 1940, anywhere: highs, lows, mean, rain and wind, day by day.",
    description="Daily observed-equivalent weather for a past date or a range of up to 31 days, from 1940 to "
    "yesterday: condition, min/max/mean temperature, precipitation total, max wind, sunrise and sunset. Older "
    "dates come from the ERA5 reanalysis (about 25 km grid); the last 92 days come from archived high-resolution "
    "forecasts, so very recent days are available too. Use it to check claims about past weather, plan by "
    "climate, or compare years. Future dates belong to open-meteo/forecast.",
    categories=(Category.weather,),
    render=Render.weather,
    price=LOCAL,
    example={"place": "Paris", "country_code": "FR", "start_date": "2024-07-26", "end_date": "2024-07-28"},
    see_also=("open-meteo/forecast",),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def history(inp: HistoryInput, ctx: RunContext) -> HistoryOutput:
    end = inp.end_date or inp.start_date
    today = datetime.now(UTC).date()
    if inp.start_date >= today:
        raise ToolNotFoundResult("history covers past days only; use open-meteo/forecast for today and later")
    end = min(end, today - timedelta(days=1))
    location = await locate(ctx, inp)
    recent = inp.start_date >= today - timedelta(days=FORECAST_PAST_DAYS_MAX)
    provider, path = (OPEN_METEO, "/v1/forecast") if recent else (OPEN_METEO_ARCHIVE, "/v1/archive")
    data = await ctx.get_json(provider, path, params={
        "latitude": location.lat, "longitude": location.lon, "timezone": "auto",
        "start_date": inp.start_date.isoformat(), "end_date": end.isoformat(), "daily": HISTORY_DAILY_VARS,
        **UNIT_PARAMS[inp.units]})
    rows = days(data.get("daily") or {})
    if not rows:
        raise ToolNotFoundResult("Open-Meteo has no data for those dates yet (the archive lags about 5 days)")
    if len(rows) < (end - inp.start_date).days + 1:
        ctx.note("Some days had no data yet and were left out (the ERA5 archive lags real time by about 5 days).")
    return HistoryOutput(location=resolved(location, data), units=UNIT_LABELS[inp.units],
                         dataset="recent" if recent else "era5", days=rows)
