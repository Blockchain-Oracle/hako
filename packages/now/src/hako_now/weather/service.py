"""/weather: the current forecast hour from MET Norway, cross-checked against NWS inside the US."""

from collections.abc import Awaitable
from datetime import datetime

from hako_core.constants.deadlines import NOW_DEADLINE_S
from hako_core.contract.enums import Agreement, SourceStatus
from hako_core.contract.sources import SourceRef
from hako_core.deadline import current_deadline
from hako_core.errors import InvalidInput, UpstreamFailure
from hako_core.fanout import fan_out
from hako_now.constants import METNO, METNO_COORD_DECIMALS, NWS, TEMP_AGREE_C, TEMP_MINOR_C, WIKIDATA_API
from hako_now.geo.wikidata import geocode
from hako_now.provenance import Freshness, Provenance, age_seconds, now_utc
from hako_now.weather import sources
from hako_now.weather.models import SourceReading, WeatherRequest, WeatherResult

FORECAST_NOTE = "values are the forecast for the current hour (nowcast), not a station observation"
US = "US"


def _temperature_agreement(temps: list[float]) -> tuple[Agreement, float | None]:
    """Absolute °C gap (not percent: 0 °C makes relative spreads meaningless)."""
    if len(temps) < 2:  # noqa: PLR2004 (agreement needs two sources)
        return Agreement.single_source, None
    gap = max(temps) - min(temps)
    label = (
        Agreement.agree if gap <= TEMP_AGREE_C else Agreement.minor_diff if gap <= TEMP_MINOR_C else Agreement.conflict
    )
    return label, round(gap, 2)


async def get_weather(req: WeatherRequest) -> tuple[WeatherResult | None, list[SourceRef], list[str]]:
    refs: list[SourceRef] = []
    unavailable: list[str] = []
    label, country = None, None
    if req.lat is None or req.lon is None:
        assert req.place
        try:
            place = await geocode(req.place)
            refs.append(SourceRef(name=WIKIDATA_API.name, status=SourceStatus.ok, licence="CC0"))
        except UpstreamFailure as failure:
            raise InvalidInput(f"Could not look up '{req.place}' right now; pass lat and lon.") from failure
        if place is None:
            raise InvalidInput(f"No place called '{req.place}' was found; pass lat and lon.")
        lat, lon, label, country = (
            place.lat,
            place.lon,
            f"{place.label} ({place.description or place.qid})",
            place.country,
        )
    else:
        lat, lon = req.lat, req.lon
    lat, lon = round(lat, METNO_COORD_DECIMALS), round(lon, METNO_COORD_DECIMALS)
    now = now_utc()
    calls: dict[str, Awaitable[object]] = {METNO.name: sources.metno(lat, lon)}
    if country in (None, US):  # NWS only covers the US; with coordinates alone let /points decide
        calls[NWS.name] = sources.nws(lat, lon, now)
    got = await fan_out(calls, current_deadline(NOW_DEADLINE_S))
    for name in calls:
        answered = name in got.ok
        status = SourceStatus.ok if got.ok.get(name) is not None else SourceStatus.not_applicable
        refs.append(SourceRef(name=name, status=status if answered else SourceStatus.unavailable))
        if not answered:
            unavailable.append(name)
    readings: list[SourceReading] = []
    alerts: list[str] = []
    extra: dict[str, float | None] = {"wind_from_deg": None, "precipitation_next_hour_mm": None}
    if (body := got.ok.get(METNO.name)) is not None:
        metno_reading, extra = sources.metno_reading(body, now)  # type: ignore[arg-type]
        readings.append(metno_reading)
    if (nws_answer := got.ok.get(NWS.name)) is not None:
        nws_reading, alerts = nws_answer  # type: ignore[misc]
        readings.append(nws_reading)
    if not readings:  # no source answered: a partial envelope with no result, never a 5xx
        return None, refs, unavailable
    primary = readings[0]
    agreement, gap = _temperature_agreement([r.temperature_c for r in readings if r.temperature_c is not None])
    issued = primary.issued_at
    return (
        WeatherResult(
            lat=lat,
            lon=lon,
            place=label,
            valid_for=primary.valid_for,
            temperature_c=primary.temperature_c,
            wind_speed_ms=primary.wind_speed_ms,
            wind_from_deg=extra.get("wind_from_deg"),
            humidity_pct=primary.humidity_pct,
            precipitation_next_hour_mm=extra.get("precipitation_next_hour_mm"),
            conditions=primary.conditions,
            readings=readings,
            alerts=alerts,
            provenance=Provenance(
                sources=[r.source for r in readings],
                as_of=issued,
                age_seconds=age_seconds(datetime.fromisoformat(issued)) if issued else None,
                freshness=Freshness.fresh,
                agreement=agreement,
                spread_pct=None,
                licence=METNO.licence if primary.source == METNO.name else NWS.licence,
                attribution=METNO.attribution if primary.source == METNO.name else NWS.attribution,
            ),
            notes=[FORECAST_NOTE, *([f"temperature gap between sources: {gap} °C"] if gap is not None else [])],
        ),
        refs,
        unavailable,
    )
