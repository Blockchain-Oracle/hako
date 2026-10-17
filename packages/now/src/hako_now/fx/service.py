"""/fx: independent central-bank rates per quote, a consensus, and per-provider freshness by its own cadence."""

from datetime import UTC, date, datetime, time, timedelta

from hako_core.constants.deadlines import NOW_DEADLINE_S
from hako_core.contract.enums import SourceStatus
from hako_core.contract.sources import SourceRef
from hako_core.deadline import current_deadline
from hako_core.errors import InvalidInput, UpstreamFailure
from hako_core.fanout import fan_out
from hako_now.consensus import numeric
from hako_now.constants import (
    ECB_XML,
    FRANKFURTER,
    FX_AGREE_PCT,
    FX_CADENCE_ALLOWANCE_DAYS,
    FX_CONSENSUS_WINDOW_BUSINESS_DAYS,
    FX_MAX_PROVIDERS,
    FX_MINOR_PCT,
    FX_PROVIDER_PRIORITY,
    FX_STALE_BUSINESS_DAYS,
    WEEKEND_DAYS,
)
from hako_now.fx import ecb, frankfurter
from hako_now.fx.frankfurter import Provider
from hako_now.fx.models import FxRequest, FxResult, ProviderRate
from hako_now.provenance import Freshness, Provenance, age_seconds, now_utc

ATTRIBUTION = "Central-bank reference rates via Frankfurter (frankfurter.dev)"
EURO = "EUR"
ECB_KEY = "ECB"
ISSUER_PREFIX_LEN = 2


def business_days_between(earlier: date, later: date) -> int:
    """Weekdays strictly after `earlier`, up to and including `later`."""
    days, day = 0, earlier
    while day < later:
        day += timedelta(days=1)
        days += day.weekday() not in WEEKEND_DAYS
    return days


def _independent(p: Provider) -> bool:
    """A national (or the euro-area) central bank publishing its own daily/weekly fixing.

    Excluded: eurozone national banks (Banca d'Italia's USD/EUR equals the ECB's to the digit), aggregators without
    a country (IMF, BIS republish member data) and monthly averages (a different measure).
    """
    if p.cadence not in FX_CADENCE_ALLOWANCE_DAYS or p.country is None:
        return False
    return p.pivot != EURO or p.key == ECB_KEY


def _issuer_of(p: Provider, codes: set[str]) -> bool:
    """ISO 4217 codes start with the issuing country's ISO 3166 code (USD→US, JPY→JP); EUR's is "EU" (ECB)."""
    return any(code[:ISSUER_PREFIX_LEN] == p.country for code in codes)


def select(catalogue: list[Provider], base: str, quotes: list[str]) -> list[Provider]:
    """Issuing central banks of the currencies first, then the priority list, then other independent publishers."""
    usable = [p for p in catalogue if _independent(p) and p.covers(base) and any(p.covers(q) for q in quotes)]
    home = [p for p in usable if _issuer_of(p, {base, *quotes})]
    ranked = home + [p for k in FX_PROVIDER_PRIORITY for p in usable if p.key == k and p not in home]
    ranked += [p for p in usable if p not in ranked]
    return ranked[:FX_MAX_PROVIDERS]


def _freshness(p: Provider, day: date, newest: date, today: date, historical: bool) -> tuple[Freshness, int]:
    age = business_days_between(day, today)
    allowance = FX_CADENCE_ALLOWANCE_DAYS.get(p.cadence or "", FX_CADENCE_ALLOWANCE_DAYS["daily"])
    if not historical and age > allowance + FX_STALE_BUSINESS_DAYS:
        return Freshness.stale, age
    return (Freshness.lagging if day < newest else Freshness.fresh), age


async def _ecb_fallback(req: FxRequest, sources: list[SourceRef]) -> list[FxResult]:
    try:
        day, table = await ecb.daily()
        sources.append(SourceRef(name=ECB_XML.name, status=SourceStatus.ok, attribution=ECB_XML.attribution))
    except UpstreamFailure:
        sources.append(SourceRef(name=ECB_XML.name, status=SourceStatus.unavailable))
        return []
    out = []
    for quote in req.quotes:
        if day is None or (rate := ecb.cross(table, req.base, quote)) is None:
            continue
        provider = ProviderRate(
            provider="ECB",
            name="European Central Bank (direct)",
            rate=round(rate, 6),
            date=day,
            rate_type="reference rate",
            cadence="daily",
            freshness=Freshness.unknown,
            issuer=quote == EURO,
            business_days_old=business_days_between(date.fromisoformat(day), now_utc().date()),
        )
        out.append(_result(req, quote, [provider], day))
    return out


def _result(req: FxRequest, quote: str, rows: list[ProviderRate], newest: str) -> FxResult:
    """The rate and the agreement check use fixings within FX_CONSENSUS_WINDOW_BUSINESS_DAYS of the newest (banks
    publish at different hours: BOC/BOE trail the ECB by a day intraday). An older fixing (FRED's weekly H.10)
    differs by market movement, not disagreement: it is listed with its age but only used when nothing is current."""
    newest_day = date.fromisoformat(newest)
    current = [
        r
        for r in rows
        if business_days_between(date.fromisoformat(r.date), newest_day) <= FX_CONSENSUS_WINDOW_BUSINESS_DAYS
    ]
    basis = current or [r for r in rows if r.freshness is not Freshness.stale] or rows
    c = numeric([r.rate for r in basis], FX_AGREE_PCT, FX_MINOR_PCT)
    issuer = next((r for r in basis if r.issuer), None)  # the quote's own central bank is authoritative
    rate = round(issuer.rate if issuer else c.value, 6)
    freshness = Freshness.fresh if current else basis[0].freshness  # current: newest fixing ± window
    return FxResult(
        base=req.base,
        quote=quote,
        rate=rate,
        date=newest,
        amount=req.amount,
        converted=round(req.amount * rate, 6) if req.amount else None,
        providers=rows,
        provenance=Provenance(
            sources=[r.provider for r in basis],
            as_of=newest,
            age_seconds=age_seconds(datetime.combine(date.fromisoformat(newest), time.min, UTC)),
            freshness=freshness,
            agreement=c.agreement,
            spread_pct=c.spread_pct,
            licence=FRANKFURTER.licence,
            attribution=ATTRIBUTION,
        ),
    )


async def get_fx(req: FxRequest) -> tuple[list[FxResult], list[SourceRef], list[str]]:
    sources: list[SourceRef] = []
    try:
        catalogue = await frankfurter.providers()
    except UpstreamFailure:
        sources.append(SourceRef(name=FRANKFURTER.name, status=SourceStatus.unavailable))
        return await _ecb_fallback(req, sources), sources, [FRANKFURTER.name]
    wanted: dict[str, set[str]] = {}  # provider → the quotes it was chosen for (selection is per quote)
    by_key: dict[str, Provider] = {}
    for quote in req.quotes:
        for p in select(catalogue, req.base, [quote]):
            wanted.setdefault(p.key, set()).add(quote)
            by_key[p.key] = p
    if not wanted:
        raise InvalidInput(f"No central bank publishes {req.base} against {', '.join(req.quotes)}.")
    calls = {k: frankfurter.rates(k, req.base, sorted(qs), req.date) for k, qs in wanted.items()}
    got = await fan_out(calls, current_deadline(NOW_DEADLINE_S))
    unavailable = [FRANKFURTER.name] if got.failed and not got.ok else []
    sources.append(
        SourceRef(
            name=FRANKFURTER.name,
            status=SourceStatus.ok if got.ok else SourceStatus.unavailable,
            licence=FRANKFURTER.licence,
            attribution=ATTRIBUTION,
        )
    )
    if not got.ok:
        return await _ecb_fallback(req, sources), sources, unavailable
    rows = [(by_key[k], r) for k, answer in got.ok.items() for r in answer]
    newest = max(date.fromisoformat(r["date"]) for _, r in rows) if rows else None
    today = now_utc().date()
    results = []
    for quote in req.quotes:
        quoted = []
        for p, r in rows:
            if r["quote"] != quote or quote not in wanted[p.key] or newest is None:
                continue
            fresh, age = _freshness(p, date.fromisoformat(r["date"]), newest, today, req.date is not None)
            quoted.append(
                ProviderRate(
                    provider=p.key,
                    name=p.name,
                    rate=r["rate"],
                    date=r["date"],
                    rate_type=p.rate_type,
                    cadence=p.cadence,
                    freshness=fresh,
                    business_days_old=age,
                    issuer=_issuer_of(p, {quote}),
                )
            )
        if quoted:
            results.append(_result(req, quote, quoted, max(q.date for q in quoted)))
    return results, sources, unavailable
