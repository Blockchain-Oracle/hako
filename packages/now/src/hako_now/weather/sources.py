"""MET Norway locationforecast (compact) and NWS hourly forecast + active alerts."""

from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from functools import cache
from typing import Any

from hako_core.cache.keys import cache_key
from hako_core.cache.store import cache as store
from hako_core.errors import UpstreamFailure
from hako_core.http.client import UpstreamClient
from hako_now import clients
from hako_now.constants import (
    FAHRENHEIT_OFFSET,
    FAHRENHEIT_SCALE,
    METNO,
    MPH_TO_MS,
    NWS,
    TTL_NWS_POINTS,
    TTL_WEATHER_FALLBACK,
)
from hako_now.weather.models import SourceReading

metno_client = cache(lambda: UpstreamClient(METNO))
nws_client = cache(lambda: UpstreamClient(NWS))
clients.register(metno_client, nws_client)
NWS_BASE = "https://api.weather.gov"
MIN_CACHE_TTL = timedelta(seconds=1)


def _expires_ttl(header: str | None) -> timedelta:
    """Time until met.no's Expires header (its ToS: do not refetch before then)."""
    if header:
        try:
            return max(MIN_CACHE_TTL, parsedate_to_datetime(header) - datetime.now(UTC))
        except (TypeError, ValueError):
            pass
    return TTL_WEATHER_FALLBACK


def _current(series: list[dict[str, Any]], now: datetime) -> dict[str, Any] | None:
    """The forecast step whose hour contains `now` (else the first future one)."""
    past = [s for s in series if datetime.fromisoformat(s["time"]) <= now]
    return past[-1] if past else (series[0] if series else None)


async def metno(lat: float, lon: float) -> dict[str, Any]:
    key = cache_key("now", "metno", "compact", f"{lat},{lon}")
    if (hit := await store.get(key)) is not None:
        return hit
    resp = await metno_client().request("GET", f"/weatherapi/locationforecast/2.0/compact?lat={lat}&lon={lon}")
    if not resp.is_success:
        raise UpstreamFailure(METNO.name, "unavailable", str(resp.status_code))
    body = resp.json()
    await store.set(key, body, _expires_ttl(resp.headers.get("expires")))
    return body


def metno_reading(body: dict[str, Any], now: datetime) -> tuple[SourceReading, dict[str, Any]]:
    step = _current(body["properties"]["timeseries"], now) or {}
    details = step.get("data", {}).get("instant", {}).get("details", {})
    next_hour = step.get("data", {}).get("next_1_hours", {})
    reading = SourceReading(
        source=METNO.name,
        valid_for=step.get("time", ""),
        temperature_c=details.get("air_temperature"),
        wind_speed_ms=details.get("wind_speed"),
        humidity_pct=details.get("relative_humidity"),
        conditions=(next_hour.get("summary") or {}).get("symbol_code"),
        issued_at=body["properties"]["meta"].get("updated_at"),
    )
    extra = {
        "wind_from_deg": details.get("wind_from_direction"),
        "precipitation_next_hour_mm": (next_hour.get("details") or {}).get("precipitation_amount"),
    }
    return reading, extra


async def _nws_hourly_url(lat: float, lon: float) -> str | None:
    key = cache_key("now", "nws", "points", f"{lat},{lon}")
    if (hit := await store.get(key)) is not None:
        return hit or None
    try:
        data, _ = await nws_client().get_json(f"/points/{lat},{lon}")
        url = data["properties"]["forecastHourly"]
    except UpstreamFailure as failure:
        if failure.kind != "not_found":  # 404: outside NWS coverage
            raise
        url = ""
    await store.set(key, url, TTL_NWS_POINTS)
    return url or None


async def nws(lat: float, lon: float, now: datetime) -> tuple[SourceReading, list[str]] | None:
    """None outside the US."""
    url = await _nws_hourly_url(lat, lon)
    if url is None:
        return None
    data, _ = await nws_client().get_json(url.removeprefix(NWS_BASE))
    props = data["properties"]
    periods = [p for p in props["periods"] if datetime.fromisoformat(p["startTime"]) <= now] or props["periods"][:1]
    p = periods[-1]
    temp = p.get("temperature")
    celsius = (
        (temp - FAHRENHEIT_OFFSET) * FAHRENHEIT_SCALE if temp is not None and p.get("temperatureUnit") == "F" else temp
    )
    mph = str(p.get("windSpeed") or "").split(" ")[0]
    alerts, _ = await nws_client().get_json(f"/alerts/active?point={lat},{lon}")
    reading = SourceReading(
        source=NWS.name,
        valid_for=datetime.fromisoformat(p["startTime"]).astimezone(UTC).isoformat(),
        temperature_c=round(celsius, 1) if celsius is not None else None,
        wind_speed_ms=round(float(mph) * MPH_TO_MS, 1) if mph.replace(".", "").isdigit() else None,
        humidity_pct=(p.get("relativeHumidity") or {}).get("value"),
        conditions=p.get("shortForecast"),
        issued_at=props.get("updateTime") or props.get("updated"),
    )
    events = [f["properties"].get("headline") or f["properties"].get("event") for f in alerts.get("features", [])]
    return reading, [e for e in events if e]
