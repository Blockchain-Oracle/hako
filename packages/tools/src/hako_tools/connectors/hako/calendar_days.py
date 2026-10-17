"""hako/holidays and hako/business-days: public and market calendars, cross-checked, and working-day maths."""

from pydantic import Field

from hako_now.constants import MAX_BUSINESS_DAY_SPAN, MAX_HOLIDAY_YEAR, MIN_HOLIDAY_YEAR
from hako_now.holidays.models import BusinessDaysRequest, BusinessDaysResult, HolidayResult, HolidaysRequest
from hako_now.holidays.service import business_days, get_holidays
from hako_tools.connectors.hako.bridge import call_now, call_now_sync, report
from hako_tools.connectors.hako.provider import HAKO
from hako_tools.constants import TTL_REFERENCE_S
from hako_tools.framework import LOCAL, Category, Render, RunContext, ToolInput, ToolOutput, tool


class HolidaysInput(ToolInput, HolidaysRequest):
    """A country (ISO 3166-1 alpha-2) and a year; optionally a subdivision or a market calendar."""


class HolidaysOutput(ToolOutput):
    country: str
    year: int
    calendar: str
    count: int
    holidays: list[HolidayResult]
    unavailable: list[str] = Field(default_factory=list)


@tool(
    provider=HAKO,
    slug="holidays",
    name="Hako Public & Market Holidays",
    summary="A country's (or region's) public holidays for a year, or a market calendar like NYSE, cross-checked "
    "across sources.",
    description=f"Holidays for a country, optionally one subdivision (e.g. US-CA, DE-BY), for any year from "
    f"{MIN_HOLIDAY_YEAR} to {MAX_HOLIDAY_YEAR}, or a market calendar (NYSE, ECB, LSE, …). The offline "
    "python-holidays calendar is merged by date with Nager.Date and OpenHolidays; every day lists which sources "
    "carry it, whether it is an observed (moved) day or only local, and whether the sources agree. Market "
    "calendars come from python-holidays alone. To count or add working days use hako/business-days.",
    categories=(Category.time,),
    render=Render.time,
    price=LOCAL,
    example={"country": "MA", "year": 2026},
    see_also=("hako/business-days", "hako/time"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def holidays(inp: HolidaysInput, ctx: RunContext) -> HolidaysOutput:
    results, sources, unavailable = await call_now(get_holidays(inp))
    missing = report(ctx, sources, unavailable)
    calendar = results[0].calendar if results else inp.calendar
    return HolidaysOutput(country=inp.country.upper(), year=inp.year, calendar=calendar, count=len(results),
                          holidays=results, unavailable=missing)


class BusinessDaysInput(ToolInput, BusinessDaysRequest):
    """A country (or market calendar), a start date, and exactly one of `end` or `add_days`."""


class BusinessDaysOutput(ToolOutput, BusinessDaysResult):
    pass


@tool(
    provider=HAKO,
    slug="business-days",
    name="Hako Business Days",
    summary="Count working days between two dates, or find the date N working days away, on a country or market "
    "calendar.",
    description="Give a start date and either an end date (counts the business days after start up to and "
    f"including end) or add_days (walks that many business days, negative goes back; up to "
    f"{MAX_BUSINESS_DAY_SPAN} days either way). Uses the country's public calendar (optionally a subdivision) or "
    "a market calendar such as NYSE, with that country's own weekend, and lists every holiday it skipped. "
    "Computed offline from python-holidays. For the list of holidays itself use hako/holidays.",
    categories=(Category.time,),
    render=Render.time,
    price=LOCAL,
    example={"country": "US", "calendar": "NYSE", "start": "2026-12-21", "add_days": 5},
    see_also=("hako/holidays", "hako/time"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def business_days_endpoint(inp: BusinessDaysInput, ctx: RunContext) -> BusinessDaysOutput:
    result = await call_now_sync(business_days, inp)
    return BusinessDaysOutput(**dict(result))
