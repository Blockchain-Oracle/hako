"""Declarative description of each upstream (limits live next to the domain that uses them)."""

from dataclasses import dataclass

from hako_core.constants.deadlines import DEFAULT_CONNECT_S, DEFAULT_TOTAL_S


@dataclass(frozen=True, slots=True)
class UpstreamSpec:
    name: str  # short, safe word used in `unavailable[]` and SourceRef.name
    base_url: str
    max_concurrency: int
    total_s: float = DEFAULT_TOTAL_S
    connect_s: float = DEFAULT_CONNECT_S
    http2: bool = False
    rate: str | None = None  # `limits` string, e.g. "10/second"; None = no client-side rate limit
    shared_quota: bool = False  # True → rate limit stored in Redis (shared with the worker)
    retry_attempts: int = 2
    licence: str | None = None
    attribution: str | None = None
