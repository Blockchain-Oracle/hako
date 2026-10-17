"""Inputs and helpers shared by every Serper endpoint (request fields per serper.dev/playground)."""

from enum import StrEnum
from typing import Any
from urllib.parse import urlparse

from pydantic import Field

from hako_tools.framework import ToolInput

QUERY_MAX_CHARS = 400  # Google reads ~32 words; this leaves room for operators such as site: and quotes
NUM_DEFAULT = 8
NUM_MAX = 10  # Serper bills 1 credit up to 10 results and 2 above, so one call never costs double
PAGE_MAX = 10
COUNTRY_PATTERN = r"^[A-Za-z]{2}$"
LANGUAGE_PATTERN = r"^[A-Za-z]{2,3}(-[A-Za-z]{2,4})?$"
INLINE_DATA_PREFIX = "data:"  # Serper sometimes inlines thumbnails as base64; agents cannot use those


class TimeRange(StrEnum):
    day = "day"
    week = "week"
    month = "month"
    year = "year"


TBS = {TimeRange.day: "qdr:d", TimeRange.week: "qdr:w", TimeRange.month: "qdr:m", TimeRange.year: "qdr:y"}


class GoogleInput(ToolInput):
    query: str = Field(min_length=1, max_length=QUERY_MAX_CHARS, description="What to search for; Google "
                       "operators such as site:, quotes and - work.")
    num: int = Field(NUM_DEFAULT, ge=1, le=NUM_MAX, description="Results to return.")
    country: str | None = Field(None, pattern=COUNTRY_PATTERN,
                                description="Two-letter country to search from, e.g. 'us', 'ng' (Google's gl).")
    language: str | None = Field(None, pattern=LANGUAGE_PATTERN,
                                 description="Result language, e.g. 'en', 'fr', 'pt-br' (Google's hl).")


class TimedGoogleInput(GoogleInput):
    time_range: TimeRange | None = Field(None, description="Only results from the past day, week, month or year.")
    page: int = Field(1, ge=1, le=PAGE_MAX, description="Results page, for more beyond the first.")


def request_body(inp: GoogleInput) -> dict[str, Any]:
    body: dict[str, Any] = {"q": inp.query, "num": inp.num}
    if inp.country:
        body["gl"] = inp.country.lower()
    if inp.language:
        body["hl"] = inp.language.lower()
    if isinstance(inp, TimedGoogleInput):
        if inp.time_range:
            body["tbs"] = TBS[inp.time_range]
        if inp.page > 1:
            body["page"] = inp.page
    return body


def host(url: str | None) -> str | None:
    if not url:
        return None
    name = urlparse(url).hostname or ""
    return name.removeprefix("www.") or None


def web_url(value: Any) -> str | None:
    """A usable http(s) URL, or None for inline base64 images and empty values."""
    text = str(value) if value else ""
    return text if text and not text.startswith(INLINE_DATA_PREFIX) else None


def as_int(value: Any) -> int | None:
    try:
        return int(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
