"""/weather request and result."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from hako_now.constants import MAX_LATITUDE, MAX_LONGITUDE, MAX_PLACE_CHARS, MIN_LATITUDE, MIN_LONGITUDE
from hako_now.provenance import Provenance


class WeatherRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"place": "Oslo"}],
            "anyOf": [
                {"required": ["lat", "lon"], "properties": {"lat": {"type": "number"}, "lon": {"type": "number"}}},
                {"required": ["place"], "properties": {"place": {"type": "string", "minLength": 1}}},
            ],
        }
    )

    lat: float | None = Field(default=None, ge=MIN_LATITUDE, le=MAX_LATITUDE)
    lon: float | None = Field(default=None, ge=MIN_LONGITUDE, le=MAX_LONGITUDE)
    place: str | None = Field(default=None, min_length=1, max_length=MAX_PLACE_CHARS)

    @model_validator(mode="after")
    def _where(self) -> "WeatherRequest":
        if self.place is None and (self.lat is None or self.lon is None):
            raise ValueError("give lat and lon, or a place")
        return self


class SourceReading(BaseModel):
    source: str
    valid_for: str  # the forecast hour this reading describes
    temperature_c: float | None = None
    wind_speed_ms: float | None = None
    humidity_pct: float | None = None
    conditions: str | None = None
    issued_at: str | None = None


class WeatherResult(BaseModel):
    kind: Literal["weather"] = "weather"
    lat: float
    lon: float
    place: str | None = None
    valid_for: str
    temperature_c: float | None
    wind_speed_ms: float | None = None
    wind_from_deg: float | None = None
    humidity_pct: float | None = None
    precipitation_next_hour_mm: float | None = None
    conditions: str | None = None
    readings: list[SourceReading]
    alerts: list[str] = Field(default_factory=list)
    provenance: Provenance
    notes: list[str] = Field(default_factory=list)
