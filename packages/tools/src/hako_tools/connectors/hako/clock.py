"""hako/time: the time in a zone, city or country (now or at an instant), DST and conversions, via tzdb."""

from pydantic import Field

from hako_core.contract.enums import SourceStatus
from hako_now.constants import MAX_CONVERT_TO
from hako_now.time.models import TimeRequest, TimeResult
from hako_now.time.service import get_time
from hako_tools.connectors.hako.bridge import call_now, report
from hako_tools.connectors.hako.provider import HAKO
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolOutput, tool


class TimeInput(ToolInput, TimeRequest):
    """Give a zone (IANA) or a place; optionally `at` (an instant with an offset or Z) and `convert_to`."""


class TimeOutput(ToolOutput, TimeResult):
    unavailable: list[str] = Field(default_factory=list)


@tool(
    provider=HAKO,
    slug="time",
    name="Hako Time Zones",
    summary="What time it is (or will be) in a city, country or IANA zone, with DST, the next clock change and "
    "conversions.",
    description="Resolves an IANA zone, a city or a country (with an optional ISO country hint) and gives the local "
    "time now or at the instant you pass, its UTC offset and abbreviation, whether daylight saving is in force, "
    f"the next offset change, and the same instant in up to {MAX_CONVERT_TO} other zones. Computed locally from "
    "the pinned IANA tz database; the answer names that version and the newest published one so you know the "
    "rules are current. 'at' must carry an offset or Z. For holidays use hako/holidays; for working-day "
    "arithmetic use hako/business-days.",
    categories=(Category.time,),
    render=Render.time,
    price=LOCAL,
    example={"place": "Casablanca", "convert_to": ["America/New_York", "Asia/Tokyo"]},
    see_also=("hako/holidays", "hako/business-days"),
    cache_ttl_s=None,  # "now" changes every second; a pinned `at` is cheap to recompute
)
async def time_now(inp: TimeInput, ctx: RunContext) -> TimeOutput:
    result, sources = await call_now(get_time(inp))
    down = [s.name for s in sources if s.status is SourceStatus.unavailable]
    unavailable = report(ctx, sources, down, result.notes)
    return TimeOutput(**{**dict(result), "notes": []}, unavailable=unavailable)
