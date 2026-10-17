"""Zone lookup from the pinned tzdata: exact IANA names, zone cities, country names, or nearest by coordinates."""

import math
from dataclasses import dataclass
from functools import cache
from importlib import resources
from zoneinfo import available_timezones

from rapidfuzz import fuzz, process

from hako_now.constants import PLACE_MATCH_MIN

EARTH_RADIUS_KM = 6371.0
ISO6709_DEG_DIGITS_LAT = 2  # ±DDMM[SS]
ISO6709_DEG_DIGITS_LON = 3  # ±DDDMM[SS]
MINUTES_PER_DEGREE = 60.0
SECONDS_PER_DEGREE = 3600.0
DMS_LEN_WITH_SECONDS_EXTRA = 2


@dataclass(frozen=True, slots=True)
class ZoneRow:
    zone: str
    countries: tuple[str, ...]
    lat: float
    lon: float
    city: str


def _tab(name: str) -> list[list[str]]:
    text = resources.files("tzdata.zoneinfo").joinpath(name).read_text(encoding="utf-8")
    return [line.split("\t") for line in text.splitlines() if line and not line.startswith("#")]


def _coord(part: str, deg_digits: int) -> float:
    sign = -1.0 if part[0] == "-" else 1.0
    digits = part[1:]
    deg = int(digits[:deg_digits])
    minutes = int(digits[deg_digits : deg_digits + 2])
    rest = digits[deg_digits + 2 :]
    seconds = int(rest) if len(rest) == DMS_LEN_WITH_SECONDS_EXTRA else 0
    return sign * (deg + minutes / MINUTES_PER_DEGREE + seconds / SECONDS_PER_DEGREE)


def _split_iso6709(value: str) -> tuple[float, float]:
    cut = max(value.rfind("+"), value.rfind("-"))  # the longitude sign
    return _coord(value[:cut], ISO6709_DEG_DIGITS_LAT), _coord(value[cut:], ISO6709_DEG_DIGITS_LON)


@cache
def zone_rows() -> tuple[ZoneRow, ...]:
    rows = []
    for cols in _tab("zone1970.tab"):
        lat, lon = _split_iso6709(cols[1])
        rows.append(ZoneRow(cols[2], tuple(cols[0].split(",")), lat, lon, cols[2].rsplit("/", 1)[-1].replace("_", " ")))
    return tuple(rows)


@cache
def countries() -> dict[str, str]:
    """ISO 3166 alpha-2 → English name."""
    return {cols[0]: cols[1] for cols in _tab("iso3166.tab")}


@cache
def _zone_names() -> dict[str, str]:
    return {z.lower(): z for z in available_timezones()}


def canonical_zone(name: str) -> str | None:
    return _zone_names().get(name.strip().replace(" ", "_").lower())


def suggest_zones(name: str, limit: int) -> list[str]:
    choices = list(_zone_names().values())
    return [m[0] for m in process.extract(name.replace(" ", "_"), choices, scorer=fuzz.WRatio, limit=limit)]


def zone_for_place(place: str, country: str | None) -> tuple[str, str] | None:
    """(zone, what matched) for a zone city ("Casablanca") or a single-zone country ("Morocco")."""
    rows = [r for r in zone_rows() if country is None or country.upper() in r.countries]
    city = process.extractOne(place, {i: r.city for i, r in enumerate(rows)}, scorer=fuzz.WRatio)
    if city and city[1] >= PLACE_MATCH_MIN:
        return rows[city[2]].zone, f"zone city {rows[city[2]].city}"
    names = countries()
    hit = process.extractOne(place, names, scorer=fuzz.WRatio)
    if hit and hit[1] >= PLACE_MATCH_MIN:
        code = hit[2]
        in_country = [r for r in zone_rows() if code in r.countries]
        if len(in_country) == 1:
            return in_country[0].zone, f"country {names[code]}"
    return None


def nearest_zone(lat: float, lon: float, country: str | None) -> str | None:
    """Closest zone1970.tab reference city, within the country when known (zones follow borders, not distance)."""
    rows = [r for r in zone_rows() if country is None or country.upper() in r.countries] or list(zone_rows())

    def km(r: ZoneRow) -> float:
        p1, p2 = math.radians(lat), math.radians(r.lat)
        dp, dl = p2 - p1, math.radians(r.lon - lon)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))

    return min(rows, key=km).zone if rows else None
