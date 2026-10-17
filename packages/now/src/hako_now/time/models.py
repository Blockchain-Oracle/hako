"""/time request and result."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from hako_now.constants import MAX_CONVERT_TO, MAX_PLACE_CHARS
from hako_now.provenance import Provenance


class TimeRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {"zone": "Africa/Casablanca", "at": "2026-11-15T18:00:00Z", "convert_to": ["America/New_York"]}
            ],
            "anyOf": [
                {"required": ["zone"], "properties": {"zone": {"type": "string", "minLength": 1}}},
                {"required": ["place"], "properties": {"place": {"type": "string", "minLength": 1}}},
            ],
        }
    )

    zone: str | None = Field(default=None, max_length=MAX_PLACE_CHARS, description="IANA zone, e.g. Africa/Casablanca")
    place: str | None = Field(default=None, max_length=MAX_PLACE_CHARS, description="City or country name")
    country: str | None = Field(default=None, min_length=2, max_length=2, description="ISO 3166-1 alpha-2 hint")
    at: datetime | None = Field(default=None, description="Instant to evaluate (ISO 8601; default now)")
    convert_to: list[str] = Field(default_factory=list, max_length=MAX_CONVERT_TO)

    @model_validator(mode="after")
    def _one_target(self) -> "TimeRequest":
        if not (self.zone or self.place):
            raise ValueError("give a zone or a place")
        return self


class Transition(BaseModel):
    at: str  # UTC instant of the change
    offset_before: str
    offset_after: str


class ZoneTime(BaseModel):
    zone: str
    local_time: str
    utc_offset: str  # "+05:30"
    abbreviation: str | None = None
    is_dst: bool


class TimeResult(BaseModel):
    kind: Literal["time"] = "time"
    zone: str
    matched: str | None = None  # how a place resolved ("zone city Casablanca", Wikidata label)
    at_utc: str
    local_time: str
    utc_offset: str
    abbreviation: str | None = None
    is_dst: bool
    next_transition: Transition | None = None
    conversions: list[ZoneTime] = Field(default_factory=list)
    tzdb_version: str
    tzdb_latest: str | None = None
    provenance: Provenance
    notes: list[str] = Field(default_factory=list)
