"""Provenance for every upstream an answer touched."""

from pydantic import BaseModel

from hako_core.contract.enums import CacheState, SourceStatus


class SourceRef(BaseModel):
    name: str
    status: SourceStatus
    url: str | None = None
    licence: str | None = None
    attribution: str | None = None
    as_of: str | None = None
    fetched_at: str | None = None
    latency_ms: int | None = None
    cache: CacheState | None = None
