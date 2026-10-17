"""/holidays and /business-days requests and results."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from hako_now.constants import MAX_BUSINESS_DAY_SPAN, MAX_HOLIDAY_YEAR, MIN_HOLIDAY_YEAR, PUBLIC_CALENDAR
from hako_now.provenance import Provenance

CountryCode = Field(min_length=2, max_length=2, pattern="^[A-Za-z]{2}$", description="ISO 3166-1 alpha-2")


class HolidaysRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"examples": [{"country": "JP", "year": 2026}]})

    country: str = CountryCode
    year: int = Field(ge=MIN_HOLIDAY_YEAR, le=MAX_HOLIDAY_YEAR)
    subdivision: str | None = Field(default=None, max_length=10, description="e.g. BY (Bavaria), CA (California)")
    calendar: str = Field(default=PUBLIC_CALENDAR, max_length=10, description="'public' or a market: NYSE, ECB, LSE…")


class HolidayResult(BaseModel):
    kind: Literal["holiday"] = "holiday"
    date: str
    name: str
    other_names: list[str] = Field(default_factory=list)
    calendar: str
    observed: bool = False  # the weekday a weekend holiday moved to
    local_only: bool = False  # a municipality-level day (e.g. Augsburg's Peace Festival)
    listed_by: list[str]
    provenance: Provenance


class BusinessDaysRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"country": "US", "calendar": "NYSE", "start": "2026-12-21", "add_days": 5}],
            "oneOf": [
                {"required": ["end"], "properties": {"end": {"type": "string"}}},
                {"required": ["add_days"], "properties": {"add_days": {"type": "integer"}}},
            ],
        }
    )

    country: str = CountryCode
    subdivision: str | None = Field(default=None, max_length=10)
    calendar: str = Field(default=PUBLIC_CALENDAR, max_length=10)
    start: date
    end: date | None = None
    add_days: int | None = Field(default=None, ge=-MAX_BUSINESS_DAY_SPAN, le=MAX_BUSINESS_DAY_SPAN)

    @model_validator(mode="after")
    def _end_or_add(self) -> "BusinessDaysRequest":
        if (self.end is None) == (self.add_days is None):
            raise ValueError("give exactly one of end or add_days")
        if self.end is not None and abs((self.end - self.start).days) > MAX_BUSINESS_DAY_SPAN:
            raise ValueError(f"the range may span at most {MAX_BUSINESS_DAY_SPAN} days")
        return self


class BusinessDaysResult(BaseModel):
    kind: Literal["business_days"] = "business_days"
    calendar: str
    start: str
    end: str
    business_days: int  # counted after start, up to and including end
    weekend: list[str]
    holidays_skipped: list[str]
    provenance: Provenance
