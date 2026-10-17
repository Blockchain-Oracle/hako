"""OpenWeather current conditions, 5-day forecast and air quality."""

from collections import Counter, defaultdict
from typing import Any

from pydantic import Field

from hako_tools.connectors.openweather.common import (
    UNIT_LABELS,
    Location,
    LocationInput,
    UnitLabels,
    Units,
    geocode,
    icon_url,
    local_time,
)
from hako_tools.connectors.openweather.provider import OPENWEATHER
from hako_tools.constants import TTL_LIVE_S, TTL_PAGE_S
from hako_tools.framework import STANDARD, Category, Render, RunContext, ToolOutput, tool

HOURLY_POINTS = 8  # 8 × 3 h = the next 24 hours in detail; the rest of the 5 days is summarised per day
DAYS_MAX = 6  # 40 three-hour steps from now can touch six calendar days
PERCENT = 100
MM_DECIMALS = 1  # gauges report precipitation to 0.1 mm
_DATE_CHARS = len("YYYY-MM-DD")
AQI_LEVELS = {1: "Good", 2: "Fair", 3: "Moderate", 4: "Poor", 5: "Very Poor"}  # OpenWeather's own scale names


class WeatherInput(LocationInput):
    units: Units = Field(Units.metric, description="metric (°C, m/s), imperial (°F, mph) or standard (K).")


class Conditions(ToolOutput):
    observed_at: str | None = None
    condition: str | None = None
    description: str | None = None
    icon_url: str | None = None
    temp: float | None = None
    feels_like: float | None = None
    temp_min: float | None = None
    temp_max: float | None = None
    humidity_pct: int | None = None
    pressure_hpa: int | None = None
    wind_speed: float | None = None
    wind_gust: float | None = None
    wind_deg: int | None = None
    clouds_pct: int | None = None
    visibility_m: int | None = None
    rain_1h_mm: float | None = None
    snow_1h_mm: float | None = None
    sunrise: str | None = None
    sunset: str | None = None


class CurrentOutput(ToolOutput):
    location: Location
    units: UnitLabels
    current: Conditions


def _location(data: dict[str, Any]) -> Location:
    coord = data.get("coord") or {}
    return Location(name=data.get("name") or None, country=(data.get("sys") or {}).get("country"),
                    lat=coord.get("lat", 0.0), lon=coord.get("lon", 0.0))


@tool(
    provider=OPENWEATHER,
    slug="current",
    name="OpenWeather Current Weather",
    summary="Weather right now for a city or coordinates: temperature, feels-like, humidity, wind, rain, sunrise.",
    description="Current conditions from OpenWeather's station and model blend, refreshed about every 10 "
    "minutes: description, temperature (with feels-like and the local min/max), humidity, pressure, wind, cloud "
    "cover, visibility, last-hour rain or snow, and local sunrise/sunset, all in the place's own time zone. "
    "Give a city ('Lagos,NG') or lat + lon. For the days ahead use openweather/forecast; for pollution use "
    "openweather/air-quality.",
    categories=(Category.weather,),
    render=Render.weather,
    price=STANDARD,
    example={"city": "Lagos,NG", "units": "metric"},
    see_also=("openweather/forecast", "openweather/air-quality", "openweather/geocode"),
    cache_ttl_s=TTL_LIVE_S,
)
async def current(inp: WeatherInput, ctx: RunContext) -> CurrentOutput:
    data = await ctx.get_json(OPENWEATHER, "/data/2.5/weather", params={**inp.params(), "units": inp.units.value})
    offset = data.get("timezone")
    main, wind, sys = data.get("main") or {}, data.get("wind") or {}, data.get("sys") or {}
    weather = (data.get("weather") or [{}])[0]
    return CurrentOutput(
        location=_location(data),
        units=UNIT_LABELS[inp.units],
        current=Conditions(
            observed_at=local_time(data.get("dt"), offset), condition=weather.get("main"),
            description=weather.get("description"), icon_url=icon_url(weather), temp=main.get("temp"),
            feels_like=main.get("feels_like"), temp_min=main.get("temp_min"), temp_max=main.get("temp_max"),
            humidity_pct=main.get("humidity"), pressure_hpa=main.get("pressure"), wind_speed=wind.get("speed"),
            wind_gust=wind.get("gust"), wind_deg=wind.get("deg"), clouds_pct=(data.get("clouds") or {}).get("all"),
            visibility_m=data.get("visibility"), rain_1h_mm=(data.get("rain") or {}).get("1h"),
            snow_1h_mm=(data.get("snow") or {}).get("1h"), sunrise=local_time(sys.get("sunrise"), offset),
            sunset=local_time(sys.get("sunset"), offset),
        ),
    )


class ForecastPoint(ToolOutput):
    time: str
    description: str | None = None
    temp: float | None = None
    feels_like: float | None = None
    precip_chance_pct: int | None = None
    rain_mm: float | None = None
    snow_mm: float | None = None
    wind_speed: float | None = None
    humidity_pct: int | None = None
    clouds_pct: int | None = None


class DayForecast(ToolOutput):
    date: str
    description: str | None = None
    temp_min: float | None = None
    temp_max: float | None = None
    precip_chance_max_pct: int | None = None
    rain_mm: float = 0.0
    snow_mm: float = 0.0
    wind_max: float | None = None


class ForecastOutput(ToolOutput):
    location: Location
    units: UnitLabels
    next_24h: list[ForecastPoint] = Field(description="Three-hourly steps for the next day.")
    days: list[DayForecast] = Field(description="One summary per local calendar day, up to 5 days ahead.")


def _point(row: dict[str, Any], offset: int | None) -> ForecastPoint:
    main, weather = row.get("main") or {}, (row.get("weather") or [{}])[0]
    pop = row.get("pop")
    return ForecastPoint(
        time=local_time(row.get("dt"), offset) or "", description=weather.get("description"), temp=main.get("temp"),
        feels_like=main.get("feels_like"), precip_chance_pct=round(pop * PERCENT) if pop is not None else None,
        rain_mm=(row.get("rain") or {}).get("3h"), snow_mm=(row.get("snow") or {}).get("3h"),
        wind_speed=(row.get("wind") or {}).get("speed"), humidity_pct=main.get("humidity"),
        clouds_pct=(row.get("clouds") or {}).get("all"),
    )


def _days(points: list[ForecastPoint]) -> list[DayForecast]:
    by_day: dict[str, list[ForecastPoint]] = defaultdict(list)
    for p in points:
        by_day[p.time[:_DATE_CHARS]].append(p)
    days = []
    for date, steps in list(by_day.items())[:DAYS_MAX]:
        temps = [s.temp for s in steps if s.temp is not None]
        chances = [s.precip_chance_pct for s in steps if s.precip_chance_pct is not None]
        winds = [s.wind_speed for s in steps if s.wind_speed is not None]
        common = Counter(s.description for s in steps if s.description).most_common(1)
        days.append(DayForecast(
            date=date, description=common[0][0] if common else None, temp_min=min(temps, default=None),
            temp_max=max(temps, default=None), precip_chance_max_pct=max(chances, default=None),
            rain_mm=round(sum(s.rain_mm or 0.0 for s in steps), MM_DECIMALS),
            snow_mm=round(sum(s.snow_mm or 0.0 for s in steps), MM_DECIMALS),
            wind_max=max(winds, default=None),
        ))
    return days


@tool(
    provider=OPENWEATHER,
    slug="forecast",
    name="OpenWeather 5-Day Forecast",
    summary="Forecast for the next 5 days: the next 24 h in 3-hour steps, then a high/low summary per day.",
    description="OpenWeather's 5-day / 3-hour forecast, condensed for an agent: the next 24 hours as 8 "
    "three-hourly points (temperature, feels-like, chance of precipitation, rain or snow, wind) and then one "
    "summary per local calendar day (most common conditions, low/high, highest precipitation chance, total "
    "rain and snow, strongest wind). Times are in the place's own time zone. Not hourly and not beyond 5 days. "
    "For conditions right now use openweather/current.",
    categories=(Category.weather,),
    render=Render.weather,
    price=STANDARD,
    example={"city": "London,GB", "units": "metric"},
    see_also=("openweather/current", "openweather/geocode"),
    cache_ttl_s=TTL_PAGE_S,
)
async def forecast(inp: WeatherInput, ctx: RunContext) -> ForecastOutput:
    data = await ctx.get_json(OPENWEATHER, "/data/2.5/forecast", params={**inp.params(), "units": inp.units.value})
    city = data.get("city") or {}
    offset = city.get("timezone")
    points = [_point(r, offset) for r in data.get("list") or [] if r.get("dt") is not None]
    coord = city.get("coord") or {}
    return ForecastOutput(
        location=Location(name=city.get("name") or None, country=city.get("country"), lat=coord.get("lat", 0.0),
                          lon=coord.get("lon", 0.0)),
        units=UNIT_LABELS[inp.units],
        next_24h=points[:HOURLY_POINTS],
        days=_days(points),
    )


class AirQualityOutput(ToolOutput):
    location: Location
    observed_at: str | None = None
    aqi: int = Field(description="OpenWeather's index: 1 Good, 2 Fair, 3 Moderate, 4 Poor, 5 Very Poor.")
    level: str
    components_ugm3: dict[str, float] = Field(description="Concentrations in μg/m³: co, no, no2, o3, so2, pm2_5, "
                                              "pm10, nh3.")


@tool(
    provider=OPENWEATHER,
    slug="air-quality",
    name="OpenWeather Air Quality",
    summary="Air quality now for a city or coordinates: 1–5 index with its level, plus PM2.5, PM10, O₃, NO₂ and more.",
    description="Current air pollution from OpenWeather's model: the 1–5 air quality index with its name (Good, "
    "Fair, Moderate, Poor, Very Poor) and concentrations of CO, NO, NO₂, O₃, SO₂, PM2.5, PM10 and NH₃ in "
    "μg/m³. Give lat + lon, or a city (looked up first with OpenWeather geocoding, taking the best match). The "
    "index is OpenWeather's European-style scale, not the US EPA AQI. No pollen data.",
    categories=(Category.weather,),
    render=Render.json,
    price=STANDARD,
    example={"city": "Delhi,IN"},
    see_also=("openweather/current", "openweather/geocode"),
    cache_ttl_s=TTL_LIVE_S,
)
async def air_quality(inp: LocationInput, ctx: RunContext) -> AirQualityOutput:
    if inp.lat is not None and inp.lon is not None:
        place = Location(lat=inp.lat, lon=inp.lon)
    else:
        place = (await geocode(ctx, inp.city or "", 1))[0]
    data = await ctx.get_json(OPENWEATHER, "/data/2.5/air_pollution", params={"lat": place.lat, "lon": place.lon})
    row = (data.get("list") or [{}])[0]
    aqi = int((row.get("main") or {}).get("aqi") or 0)
    components = {k: float(v) for k, v in (row.get("components") or {}).items() if isinstance(v, int | float)}
    return AirQualityOutput(location=place, observed_at=local_time(row.get("dt"), None), aqi=aqi,
                            level=AQI_LEVELS.get(aqi, "unknown"), components_ugm3=components)
