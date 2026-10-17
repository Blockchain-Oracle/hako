"""Location input, units and helpers shared by the OpenWeather endpoints (openweathermap.org/api, 2026-10-07)."""

from datetime import UTC, datetime, timedelta, timezone
from enum import StrEnum
from typing import Any, Self

from pydantic import Field, model_validator

from hako_tools.connectors.openweather.provider import OPENWEATHER
from hako_tools.framework import RunContext, ToolInput, ToolNotFoundResult, ToolOutput

LAT_MAX = 90.0
LON_MAX = 180.0
CITY_MIN_CHARS = 2
CITY_MAX_CHARS = 100
GEOCODE_LIMIT_MAX = 5  # the geocoding API returns at most 5 candidates
ICON_URL = "https://openweathermap.org/img/wn/{icon}@2x.png"
_CITY_HELP = "City name, optionally with state and ISO country code: 'Lagos,NG', 'Springfield,IL,US', 'Paris,FR'."


class Units(StrEnum):
    metric = "metric"  # °C, m/s
    imperial = "imperial"  # °F, mph
    standard = "standard"  # K, m/s


class UnitLabels(ToolOutput):
    temperature: str
    wind_speed: str
    precipitation: str = "mm"


UNIT_LABELS = {
    Units.metric: UnitLabels(temperature="°C", wind_speed="m/s"),
    Units.imperial: UnitLabels(temperature="°F", wind_speed="mph"),
    Units.standard: UnitLabels(temperature="K", wind_speed="m/s"),
}


class LocationInput(ToolInput):
    city: str | None = Field(None, min_length=CITY_MIN_CHARS, max_length=CITY_MAX_CHARS, description=_CITY_HELP)
    lat: float | None = Field(None, ge=-LAT_MAX, le=LAT_MAX, description="Latitude, with lon (instead of city).")
    lon: float | None = Field(None, ge=-LON_MAX, le=LON_MAX, description="Longitude, with lat.")

    @model_validator(mode="after")
    def _one_location(self) -> Self:
        has_coords = self.lat is not None and self.lon is not None
        if (self.lat is None) != (self.lon is None):
            raise ValueError("give lat and lon together")
        if has_coords == bool(self.city):
            raise ValueError("give either city or lat + lon")
        return self

    def params(self) -> dict[str, Any]:
        if self.lat is not None and self.lon is not None:
            return {"lat": self.lat, "lon": self.lon}
        return {"q": self.city}


class Location(ToolOutput):
    name: str | None = None
    state: str | None = None
    country: str | None = None
    lat: float
    lon: float


def local_time(unix: Any, offset_s: int | None) -> str | None:
    """ISO 8601 in the location's own time zone (with its UTC offset), or UTC when the offset is unknown."""
    if unix is None:
        return None
    tz = timezone(timedelta(seconds=offset_s)) if offset_s is not None else UTC
    return datetime.fromtimestamp(int(unix), tz=tz).isoformat()


def icon_url(weather: dict[str, Any]) -> str | None:
    icon = weather.get("icon")
    return ICON_URL.format(icon=icon) if icon else None


async def geocode(ctx: RunContext, query: str, limit: int) -> list[Location]:
    """City name → candidate places (`/geo/1.0/direct`). Raises not-found when there is none."""
    rows = await ctx.get_json(OPENWEATHER, "/geo/1.0/direct", params={"q": query, "limit": limit})
    places = [Location(name=r.get("name"), state=r.get("state"), country=r.get("country"), lat=r["lat"],
                       lon=r["lon"]) for r in rows or [] if isinstance(r, dict) and "lat" in r and "lon" in r]
    if not places:
        raise ToolNotFoundResult(f"OpenWeather knows no place called {query!r}")
    return places
