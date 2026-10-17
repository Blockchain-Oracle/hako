"""Offsets, abbreviations and the next rule change, computed from the pinned tzdata (never a live service)."""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import tzdata

from hako_core.cache.keys import cache_key
from hako_core.cache.store import cache
from hako_core.errors import UpstreamFailure
from hako_now import clients
from hako_now.constants import (
    MINUTES_PER_HOUR,
    SECONDS_PER_MINUTE,
    TRANSITION_PRECISION_S,
    TRANSITION_SCAN_DAYS,
    TTL_TZDB_LATEST,
)
from hako_now.time.models import Transition, ZoneTime

PINNED_VERSION = tzdata.IANA_VERSION


def format_offset(delta: timedelta | None) -> str:
    total = int((delta or timedelta()).total_seconds()) // SECONDS_PER_MINUTE
    sign = "-" if total < 0 else "+"
    hours, minutes = divmod(abs(total), MINUTES_PER_HOUR)
    return f"{sign}{hours:02d}:{minutes:02d}"


def zone_time(zone: str, at: datetime) -> ZoneTime:
    local = at.astimezone(ZoneInfo(zone))
    return ZoneTime(
        zone=zone,
        local_time=local.isoformat(timespec="seconds"),
        utc_offset=format_offset(local.utcoffset()),
        abbreviation=local.tzname(),
        is_dst=bool(local.dst()),
    )


def next_transition(zone: str, at: datetime) -> Transition | None:
    """Day-step scan for the next offset change, then bisection to the second."""
    tz = ZoneInfo(zone)
    start_offset = at.astimezone(tz).utcoffset()
    lo = at
    for _ in range(TRANSITION_SCAN_DAYS):
        hi = lo + timedelta(days=1)
        if hi.astimezone(tz).utcoffset() != start_offset:
            while (hi - lo).total_seconds() > TRANSITION_PRECISION_S:
                mid = lo + (hi - lo) / 2
                if mid.astimezone(tz).utcoffset() == start_offset:
                    lo = mid
                else:
                    hi = mid
            change = hi.replace(microsecond=0)
            return Transition(
                at=change.astimezone(UTC).isoformat(),
                offset_before=format_offset(start_offset),
                offset_after=format_offset(change.astimezone(tz).utcoffset()),
            )
        lo = hi
    return None


async def latest_version() -> str | None:
    """The newest tzdb IANA has published (daily cache): tells callers when our pinned rules are behind."""
    key = cache_key("now", "iana", "tzdb", "version")
    if (hit := await cache.get(key)) is not None:
        return hit
    try:
        resp = await clients.iana().request("GET", "/time-zones/tzdb/version")
    except UpstreamFailure:
        return None
    version = resp.text.strip() if resp.is_success else None
    if version:
        await cache.set(key, version, TTL_TZDB_LATEST)
    return version
