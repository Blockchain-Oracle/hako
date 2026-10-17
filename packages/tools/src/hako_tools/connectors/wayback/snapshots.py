"""wayback/snapshot: the archived capture of a URL closest to a moment (the Wayback availability API)."""

import re
from datetime import datetime
from typing import Any

from pydantic import Field, field_validator

from hako_tools.connectors.wayback.provider import WAYBACK
from hako_tools.constants import RUN_DEADLINE_MAX_S, TTL_PAGE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolNotFoundResult, ToolOutput, tool

URL_MAX_CHARS = 2_000
WAYBACK_TS_FORMAT = "%Y%m%d%H%M%S"
WAYBACK_TS_DIGITS = 14  # YYYYMMDDhhmmss; shorter prefixes (YYYY, YYYYMM, …) are allowed
# 2010, 2010-01, 2010-01-31, 2010-01-31T12:30:00Z or the digits-only Wayback form.
_MOMENT = re.compile(r"^\d{4}(?:-?\d{2}(?:-?\d{2}(?:[T ]?\d{2}(?::?\d{2}(?::?\d{2})?)?)?)?)?Z?$")
_NON_DIGIT = re.compile(r"\D")


class SnapshotInput(ToolInput):
    url: str = Field(min_length=3, max_length=URL_MAX_CHARS, pattern=r"^\S+$",
                     description="The page to look up, e.g. 'https://www.python.org/downloads' or 'python.org'.")
    at: str | None = Field(None, description="Closest to this moment: '2015', '2015-06-30' or "
                           "'2015-06-30T12:00:00Z' (default: the newest capture).")

    @field_validator("at")
    @classmethod
    def _moment(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not _MOMENT.match(value):
            raise ValueError("use YYYY, YYYY-MM-DD or YYYY-MM-DDThh:mm:ssZ")
        return _NON_DIGIT.sub("", value)[:WAYBACK_TS_DIGITS]


class SnapshotOutput(ToolOutput):
    url: str
    archived_url: str
    timestamp: str  # Wayback form, YYYYMMDDhhmmss (UTC)
    captured_at: str | None = None  # the same instant as ISO 8601
    status: int | None = None  # the HTTP status the site answered when it was captured
    requested_at: str | None = None


def _iso(timestamp: str) -> str | None:
    try:
        return datetime.strptime(timestamp, WAYBACK_TS_FORMAT).isoformat() + "Z"
    except ValueError:
        return None


@tool(
    provider=WAYBACK,
    slug="snapshot",
    name="Wayback Machine Snapshot",
    summary="Find the Internet Archive's capture of a URL closest to a date (or its newest capture).",
    description="Asks the Wayback Machine for the archived copy of a page nearest to a moment you give (or the "
    "newest one) and returns the web.archive.org link, the capture time and the HTTP status the site returned "
    "when it was archived. Use it for 'what did this page say in 2019', dead links and changed pricing pages. It "
    "returns the link, not the page: read the archived_url with firecrawl/scrape or jina/read. The Wayback "
    "Machine allows about 15 lookups a minute, so results are cached.",
    categories=(Category.web_extraction, Category.research),
    render=Render.json,
    price=LOCAL,
    example={"url": "https://www.python.org/", "at": "2010-01-01"},
    see_also=("firecrawl/scrape", "jina/read", "serper/search"),
    deadline_s=RUN_DEADLINE_MAX_S,  # an uncached availability lookup takes ~5 s on the archive's side (measured)
    cache_ttl_s=TTL_PAGE_S,
)
async def snapshot(inp: SnapshotInput, ctx: RunContext) -> SnapshotOutput:
    params: dict[str, Any] = {"url": inp.url}
    if inp.at:
        params["timestamp"] = inp.at
    data = await ctx.get_json(WAYBACK, "/wayback/available", params=params)
    closest = (data.get("archived_snapshots") or {}).get("closest") or {}
    if not closest.get("available") or not closest.get("url"):
        raise ToolNotFoundResult(f"The Wayback Machine has no capture of {inp.url}")
    timestamp = str(closest.get("timestamp") or "")
    status = closest.get("status")
    return SnapshotOutput(
        url=inp.url,
        archived_url=str(closest["url"]).replace("http://", "https://", 1),
        timestamp=timestamp,
        captured_at=_iso(timestamp),
        status=int(status) if isinstance(status, str) and status.isdigit() else None,
        requested_at=inp.at,
    )
