"""python-holidays: the offline calendar (public holidays per country/subdivision, and market calendars)."""

from datetime import date
from functools import cache

import holidays as holidays_lib

from hako_core.errors import InvalidInput
from hako_now.constants import PUBLIC_CALENDAR

WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
OBSERVED_MARK = "(observed)"
ENGLISH = "en_US"  # answer in English where the country module has a translation


@cache
def _markets() -> frozenset[str]:
    return frozenset(holidays_lib.list_supported_financial())


def calendar_for(
    country: str, subdivision: str | None, calendar: str, years: tuple[int, ...]
) -> holidays_lib.HolidayBase:
    code = calendar.upper()
    try:
        if calendar.lower() == PUBLIC_CALENDAR:
            cls = holidays_lib.country_holidays(country.upper()).__class__
            language = ENGLISH if ENGLISH in getattr(cls, "supported_languages", ()) else None
            return holidays_lib.country_holidays(country.upper(), subdiv=subdivision, years=years, language=language)
        if code in _markets():
            return holidays_lib.financial_holidays(code, years=years)
    except NotImplementedError as exc:
        raise InvalidInput(
            f"No holiday calendar for {country.upper()}{'-' + subdivision if subdivision else ''}."
        ) from exc
    raise InvalidInput(f"Unknown calendar '{calendar}'.", details=[f"markets: {', '.join(sorted(_markets()))}"])


def entries(cal: holidays_lib.HolidayBase) -> dict[date, str]:
    return dict(sorted(cal.items()))


def weekend(cal: holidays_lib.HolidayBase) -> frozenset[int]:
    return frozenset(getattr(cal, "weekend", {5, 6}))


def is_observed(name: str) -> bool:
    return OBSERVED_MARK in name
