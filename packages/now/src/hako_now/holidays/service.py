"""/holidays: the offline calendar cross-checked against Nager.Date and OpenHolidays; /business-days: offline."""

from datetime import date, timedelta

from hako_core.constants.deadlines import NOW_DEADLINE_S
from hako_core.contract.enums import Agreement, SourceStatus
from hako_core.contract.sources import SourceRef
from hako_core.deadline import current_deadline
from hako_core.errors import UpstreamFailure
from hako_core.fanout import fan_out
from hako_now.constants import (
    CALENDAR_DAYS_PER_BUSINESS_DAY_MAX,
    HOLIDAYS_LIB,
    HOLIDAYS_LIB_LICENCE,
    MINOR_DIFF_MAX_DATES,
    MINOR_DIFF_MAX_SHARE,
    NAGER,
    OPENHOLIDAYS,
    PUBLIC_CALENDAR,
)
from hako_now.holidays import local, remote
from hako_now.holidays.models import BusinessDaysRequest, BusinessDaysResult, HolidayResult, HolidaysRequest
from hako_now.provenance import Freshness, Provenance

Listing = dict[str, tuple[str, bool]]  # date → (name, local_only)
_SPECS = {"nager.date": NAGER, "openholidays": OPENHOLIDAYS}


def _local_listing(req: HolidaysRequest) -> Listing:
    cal = local.calendar_for(req.country, req.subdivision, req.calendar, (req.year,))
    return {d.isoformat(): (name, False) for d, name in local.entries(cal).items()}


def calendar_agreement(listings: dict[str, Listing]) -> Agreement:
    """Compare the dates each source lists (local-only days excluded): equal → agree; a few apart → minor_diff."""
    if len(listings) < 2:  # noqa: PLR2004 (agreement needs two sources)
        return Agreement.single_source
    sets = [{d for d, (_, local_only) in listing.items() if not local_only} for listing in listings.values()]
    union, common = set.union(*sets), set.intersection(*sets)
    differing = len(union - common)
    if differing == 0:
        return Agreement.agree
    if differing <= max(MINOR_DIFF_MAX_DATES, MINOR_DIFF_MAX_SHARE * len(union)):
        return Agreement.minor_diff
    return Agreement.conflict


async def _remote(req: HolidaysRequest, sources: list[SourceRef], unavailable: list[str]) -> dict[str, Listing]:
    if req.calendar.lower() != PUBLIC_CALENDAR:
        return {}  # market calendars have no independent free source
    calls = {"nager.date": remote.nager(req.country, req.year, req.subdivision)}
    try:
        if req.country.upper() in await remote.openholidays_countries():
            calls["openholidays"] = remote.openholidays(req.country, req.year, req.subdivision)
    except UpstreamFailure:
        unavailable.append(OPENHOLIDAYS.name)
    got = await fan_out(calls, current_deadline(NOW_DEADLINE_S))
    for name in got.ok:
        sources.append(SourceRef(name=name, status=SourceStatus.ok, licence=_SPECS[name].licence))
    for name, kind in got.failed.items():
        status = SourceStatus.not_found if kind == SourceStatus.not_found else SourceStatus.unavailable
        sources.append(SourceRef(name=name, status=status))
        if status is SourceStatus.unavailable:
            unavailable.append(name)
    return {name: listing for name, listing in got.ok.items() if listing}


async def get_holidays(req: HolidaysRequest) -> tuple[list[HolidayResult], list[SourceRef], list[str]]:
    sources = [SourceRef(name=HOLIDAYS_LIB, status=SourceStatus.ok, licence=HOLIDAYS_LIB_LICENCE)]
    unavailable: list[str] = []
    listings: dict[str, Listing] = {HOLIDAYS_LIB: _local_listing(req)}
    listings |= await _remote(req, sources, unavailable)
    agreement = calendar_agreement(listings)
    results = []
    for day in sorted(set().union(*listings.values())):
        listed = {src: listing[day] for src, listing in listings.items() if day in listing}
        names = list(dict.fromkeys(name for name, _ in listed.values() if name))
        local_only = all(lo for _, lo in listed.values())
        item_agreement = Agreement.agree if len(listed) == len(listings) else agreement
        results.append(
            HolidayResult(
                date=day,
                name=names[0] if names else "",
                other_names=names[1:],
                calendar=req.calendar.upper() if req.calendar.lower() != PUBLIC_CALENDAR else PUBLIC_CALENDAR,
                observed=any(local.is_observed(n) for n in names),
                local_only=local_only,
                listed_by=sorted(listed),
                provenance=Provenance(
                    sources=sorted(listed),
                    as_of=str(req.year),
                    freshness=Freshness.fresh,
                    agreement=item_agreement if len(listings) > 1 else Agreement.single_source,
                    licence=", ".join(sorted({s.licence for s in sources if s.name in listed and s.licence})),
                ),
            )
        )
    return results, sources, unavailable


def _walk(start: date, end: date | None, add_days: int | None, is_business: object) -> tuple[date, int, list[date]]:
    """Step day by day from start (exclusive): to `end`, or until `add_days` business days have passed."""
    goal = end if end is not None else None
    direction = 1 if (goal is not None and goal >= start) or (goal is None and (add_days or 0) >= 0) else -1
    step = timedelta(days=direction)
    day, count, holidays_hit = start, 0, []
    while (goal is not None and day != goal) or (goal is None and count < abs(add_days or 0)):
        day += step
        if is_business(day):  # type: ignore[operator]
            count += 1
        else:
            holidays_hit.append(day)
    return day, count * direction, holidays_hit


def business_days(req: BusinessDaysRequest) -> BusinessDaysResult:
    """Counted after `start`, up to and including `end`; add_days walks that many business days from start."""
    reach = abs(req.add_days or 0) * CALENDAR_DAYS_PER_BUSINESS_DAY_MAX
    edge = req.end or req.start + timedelta(days=reach if (req.add_days or 0) >= 0 else -reach)
    lo, hi = sorted((req.start, edge))
    cal = local.calendar_for(req.country, req.subdivision, req.calendar, tuple(range(lo.year, hi.year + 1)))
    weekend = local.weekend(cal)
    end, count, off_days = _walk(
        req.start, req.end, req.add_days, lambda d: d.weekday() not in weekend and d not in cal
    )
    return BusinessDaysResult(
        calendar=req.calendar,
        start=req.start.isoformat(),
        end=end.isoformat(),
        business_days=count,
        weekend=[local.WEEKDAY_NAMES[w] for w in sorted(weekend)],
        holidays_skipped=[f"{d.isoformat()} {cal.get(d)}" for d in off_days if d in cal],
        provenance=Provenance(sources=[HOLIDAYS_LIB], freshness=Freshness.fresh, licence=HOLIDAYS_LIB_LICENCE),
    )
