"""Place input, units, WMO weather codes and the daily-row reader shared by the Open-Meteo endpoints."""

from enum import StrEnum
from typing import Any, Self

from pydantic import Field, model_validator

from hako_tools.connectors.openmeteo.provider import OPEN_METEO_GEOCODING
from hako_tools.framework import RunContext, ToolInput, ToolNotFoundResult, ToolOutput

LAT_MAX = 90.0
LON_MAX = 180.0
PLACE_MIN_CHARS = 2
PLACE_MAX_CHARS = 100
COUNTRY_CODE_CHARS = 2
PERCENT_MAX = 100
COORD_DECIMALS = 4

# WMO 4677 present-weather codes as Open-Meteo reports them (open-meteo.com/en/docs, "WMO Weather interpretation").
WMO_CODES: dict[int, str] = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "depositing rime fog",
    51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle", 56: "light freezing drizzle",
    57: "dense freezing drizzle", 61: "slight rain", 63: "moderate rain", 65: "heavy rain",
    66: "light freezing rain", 67: "heavy freezing rain", 71: "slight snowfall", 73: "moderate snowfall",
    75: "heavy snowfall", 77: "snow grains", 80: "slight rain showers", 81: "moderate rain showers",
    82: "violent rain showers", 85: "slight snow showers", 86: "heavy snow showers", 95: "thunderstorm",
    96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail",
}


class Units(StrEnum):
    metric = "metric"  # °C, m/s, mm
    imperial = "imperial"  # °F, mph, inch


class UnitLabels(ToolOutput):
    temperature: str
    wind_speed: str
    precipitation: str


UNIT_LABELS = {
    Units.metric: UnitLabels(temperature="°C", wind_speed="m/s", precipitation="mm"),
    Units.imperial: UnitLabels(temperature="°F", wind_speed="mph", precipitation="inch"),
}
UNIT_PARAMS = {
    Units.metric: {"temperature_unit": "celsius", "wind_speed_unit": "ms", "precipitation_unit": "mm"},
    Units.imperial: {"temperature_unit": "fahrenheit", "wind_speed_unit": "mph", "precipitation_unit": "inch"},
}


class PlaceInput(ToolInput):
    place: str | None = Field(None, min_length=PLACE_MIN_CHARS, max_length=PLACE_MAX_CHARS,
                              description="A city or place name: 'Lagos', 'Lake Tahoe', 'Bondi Beach'.")
    country_code: str | None = Field(None, min_length=COUNTRY_CODE_CHARS, max_length=COUNTRY_CODE_CHARS,
                                     description="ISO 3166-1 alpha-2 code to pick the right place: 'NG', 'US'.")
    lat: float | None = Field(None, ge=-LAT_MAX, le=LAT_MAX, description="Latitude, with lon (instead of place).")
    lon: float | None = Field(None, ge=-LON_MAX, le=LON_MAX, description="Longitude, with lat.")

    @model_validator(mode="after")
    def _one_location(self) -> Self:
        if (self.lat is None) != (self.lon is None):
            raise ValueError("give lat and lon together")
        if (self.lat is not None) == bool(self.place):
            raise ValueError("give either place or lat + lon")
        return self


class Location(ToolOutput):
    name: str | None = None
    state: str | None = None
    country: str | None = None
    lat: float
    lon: float
    timezone: str | None = None


async def locate(ctx: RunContext, inp: PlaceInput) -> Location:
    """The input's coordinates, or the best geocoding match for its place name (not-found when there is none)."""
    if inp.lat is not None and inp.lon is not None:
        return Location(lat=inp.lat, lon=inp.lon)
    params: dict[str, Any] = {"name": inp.place, "count": 1, "language": "en", "format": "json"}
    if inp.country_code:
        params["countryCode"] = inp.country_code.upper()
    rows = (await ctx.get_json(OPEN_METEO_GEOCODING, "/v1/search", params=params) or {}).get("results") or []
    if not rows:
        raise ToolNotFoundResult(f"Open-Meteo knows no place called {inp.place!r}")
    top = rows[0]
    return Location(name=top.get("name"), state=top.get("admin1"), country=top.get("country"),
                    lat=round(float(top["latitude"]), COORD_DECIMALS), lon=round(float(top["longitude"]),
                                                                                  COORD_DECIMALS),
                    timezone=top.get("timezone"))


def describe(code: Any) -> str | None:
    return WMO_CODES.get(int(code)) if isinstance(code, int | float) else None


class DayWeather(ToolOutput):
    date: str
    description: str | None = None
    temp_min: float | None = None
    temp_max: float | None = None
    temp_mean: float | None = None
    precipitation: float | None = None
    precip_chance_max_pct: int | None = Field(None, ge=0, le=PERCENT_MAX)
    wind_max: float | None = None
    uv_index_max: float | None = None
    sunrise: str | None = None
    sunset: str | None = None


# Open-Meteo daily variable → DayWeather field
DAILY_FIELDS = {
    "temperature_2m_min": "temp_min", "temperature_2m_max": "temp_max", "temperature_2m_mean": "temp_mean",
    "precipitation_sum": "precipitation", "precipitation_probability_max": "precip_chance_max_pct",
    "wind_speed_10m_max": "wind_max", "uv_index_max": "uv_index_max", "sunrise": "sunrise", "sunset": "sunset",
}


def at(columns: dict[str, Any], var: str, i: int) -> Any:
    """`columns[var][i]` from Open-Meteo's column arrays, or None when the variable or the row is missing."""
    values = columns.get(var)
    return values[i] if isinstance(values, list) and i < len(values) else None


def days(daily: dict[str, Any]) -> list[DayWeather]:
    """Column arrays (`daily.time[i]`, `daily.<var>[i]`) → one row per day; days with no values at all are dropped."""
    rows: list[DayWeather] = []
    for i, date in enumerate(daily.get("time") or []):
        values = {field: at(daily, var, i) for var, field in DAILY_FIELDS.items()}
        code = at(daily, "weather_code", i)
        if code is None and all(v is None for v in values.values()):
            continue
        rows.append(DayWeather(date=date, description=describe(code), **values))
    return rows


def resolved(location: Location, payload: dict[str, Any]) -> Location:
    """The location with the API's time zone filled in when geocoding did not give one."""
    return location.model_copy(update={"timezone": location.timezone or payload.get("timezone")})
