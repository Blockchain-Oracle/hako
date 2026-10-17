"""/time: resolve the zone, then compute everything locally from the pinned tz database."""

from datetime import UTC

from hako_core.contract.enums import SourceStatus
from hako_core.contract.sources import SourceRef
from hako_core.errors import InvalidInput, UpstreamFailure
from hako_now.constants import IANA, WIKIDATA_API
from hako_now.geo.wikidata import geocode
from hako_now.provenance import Freshness, Provenance, now_utc
from hako_now.time.models import TimeRequest, TimeResult
from hako_now.time.tzdb import PINNED_VERSION, latest_version, next_transition, zone_time
from hako_now.time.zones import canonical_zone, nearest_zone, suggest_zones, zone_for_place

SUGGESTIONS = 3
TZDB_ATTRIBUTION = "IANA tz database (public domain), via the tzdata package"


def _zone(name: str) -> str:
    zone = canonical_zone(name)
    if zone is None:
        raise InvalidInput(
            f"Unknown time zone '{name}'.", details=[f"did you mean {', '.join(suggest_zones(name, SUGGESTIONS))}?"]
        )
    return zone


async def _resolve(req: TimeRequest, sources: list[SourceRef]) -> tuple[str, str | None]:
    if req.zone:
        return _zone(req.zone), None
    assert req.place
    if exact := canonical_zone(req.place):
        return exact, None
    if local := zone_for_place(req.place, req.country):
        return local
    try:
        place = await geocode(req.place)
        sources.append(SourceRef(name=WIKIDATA_API.name, status=SourceStatus.ok, licence="CC0"))
    except UpstreamFailure as failure:
        sources.append(SourceRef(name=WIKIDATA_API.name, status=SourceStatus.unavailable))
        raise InvalidInput(f"Could not look up '{req.place}' right now; pass an IANA zone instead.") from failure
    if place is None:
        raise InvalidInput(f"No place called '{req.place}' was found; pass an IANA zone instead.")
    zone = nearest_zone(place.lat, place.lon, req.country or place.country)
    if zone is None:
        raise InvalidInput(f"No time zone found for '{req.place}'.")
    return zone, f"{place.label} ({place.description or place.qid}), nearest zone city"


async def get_time(req: TimeRequest) -> tuple[TimeResult, list[SourceRef]]:
    sources: list[SourceRef] = []
    zone, matched = await _resolve(req, sources)
    at = req.at or now_utc()
    if at.tzinfo is None:
        raise InvalidInput("'at' needs a UTC offset or 'Z' (e.g. 2026-11-15T18:00:00Z).")
    here = zone_time(zone, at)
    conversions = [zone_time(_zone(z), at) for z in req.convert_to]
    latest = await latest_version()
    sources.append(SourceRef(name=IANA.name, status=SourceStatus.ok if latest else SourceStatus.unavailable))
    behind = latest is not None and latest != PINNED_VERSION
    notes = [f"tzdb {latest} is published; these rules are {PINNED_VERSION}"] if behind else []
    return (
        TimeResult(
            zone=zone,
            matched=matched,
            at_utc=at.astimezone(UTC).isoformat(timespec="seconds"),
            local_time=here.local_time,
            utc_offset=here.utc_offset,
            abbreviation=here.abbreviation,
            is_dst=here.is_dst,
            next_transition=next_transition(zone, at),
            conversions=conversions,
            tzdb_version=PINNED_VERSION,
            tzdb_latest=latest,
            provenance=Provenance(
                sources=["tzdb"],
                as_of=PINNED_VERSION,
                freshness=Freshness.unknown if latest is None else Freshness.stale if behind else Freshness.fresh,
                licence="public domain",
                attribution=TZDB_ATTRIBUTION,
            ),
            notes=notes,
        ),
        sources,
    )
