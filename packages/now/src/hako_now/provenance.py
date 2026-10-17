"""Every answer says where it came from, how old it is, and whether its sources agree."""

from datetime import UTC, datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from hako_core.contract.enums import Agreement


class Freshness(StrEnum):
    fresh = "fresh"  # the newest data the source publishes
    lagging = "lagging"  # on the source's own schedule, but older than other sources
    stale = "stale"  # later than the source's publishing schedule allows
    unknown = "unknown"


class Provenance(BaseModel):
    sources: list[str] = Field(default_factory=list)
    as_of: str | None = None  # when the underlying data was true / published
    age_seconds: int | None = None
    freshness: Freshness = Freshness.unknown
    agreement: Agreement = Agreement.single_source
    spread_pct: float | None = None
    licence: str | None = None
    attribution: str | None = None


def now_utc() -> datetime:
    return datetime.now(UTC)


def age_seconds(as_of: datetime) -> int:
    return max(0, int((now_utc() - as_of).total_seconds()))
