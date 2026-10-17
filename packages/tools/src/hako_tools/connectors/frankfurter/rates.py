"""Frankfurter v2 endpoints: latest (or dated) rates, a conversion, and a daily history of up to 90 days."""

import datetime as dt
from enum import StrEnum
from typing import Annotated, Any

from pydantic import AfterValidator, Field, model_validator

from hako_tools.connectors.frankfurter.provider import FRANKFURTER
from hako_tools.constants import TTL_PAGE_S, TTL_REFERENCE_S
from hako_tools.framework import LOCAL, Category, ProviderError, Render, RunContext, ToolInput, ToolOutput, tool
from hako_tools.framework.errors import InvalidToolInput, ToolNotFoundResult

CURRENCY_LEN = 3
MAX_QUOTES = 10
HISTORY_MAX_QUOTES = 5
HISTORY_MAX_DAYS = 90  # a quarter of daily points per currency stays a small table
CONVERTED_DECIMALS = 4
CHANGE_DECIMALS = 3
PERCENT = 100
HTTP_UNPROCESSABLE_MARK = "HTTP 422"  # Frankfurter's answer to an unknown currency or provider
PROVIDER_PATTERN = r"^[A-Za-z0-9_]{2,16}$"
BLENDED = "blended"

CurrencyCode = Annotated[
    str,
    Field(min_length=CURRENCY_LEN, max_length=CURRENCY_LEN, pattern=r"^[A-Za-z]{3}$", description="ISO 4217, e.g. USD"),
    AfterValidator(str.upper),
]
ProviderKey = Field(None, pattern=PROVIDER_PATTERN,
                    description="One central bank's fixing, by Frankfurter provider key (e.g. ECB, FRED, BOE); "
                    "default: Frankfurter's blend of every bank that publishes the pair.")


async def _rows(ctx: RunContext, path: str, params: dict[str, Any]) -> Any:
    try:
        return await ctx.get_json(FRANKFURTER, path, params=params)
    except ProviderError as exc:
        if HTTP_UNPROCESSABLE_MARK in exc.message:  # e.g. {"status":422,"message":"invalid currency: XXX"}
            raise InvalidToolInput("Frankfurter does not know that currency or provider", details=exc.details) from exc
        raise


def _scope(params: dict[str, Any], provider: str | None) -> str:
    if provider:
        params["providers"] = provider.upper()
        return provider.upper()
    return BLENDED


class Rate(ToolOutput):
    base: str
    quote: str
    rate: float
    date: str


def _rate(row: dict[str, Any]) -> Rate:
    return Rate(base=row["base"], quote=row["quote"], rate=row["rate"], date=row["date"])


class RatesInput(ToolInput):
    base: CurrencyCode = "EUR"
    quotes: list[CurrencyCode] = Field(min_length=1, max_length=MAX_QUOTES, description="Currencies to price.")
    date: dt.date | None = Field(None, description="Rates published on or before this day (default: latest).")
    provider: str | None = ProviderKey


class RatesOutput(ToolOutput):
    base: str
    provider: str
    rates: list[Rate]


@tool(
    provider=FRANKFURTER,
    slug="rates",
    name="Frankfurter Exchange Rates",
    summary="Latest or historical exchange rates from a base currency to up to ten others, from central banks.",
    description="Rates from one currency to up to ten others, latest or as of a date, each with the date it was "
    "published. By default Frankfurter blends every central bank that publishes the pair (wide coverage, "
    "including weekends where some bank publishes); name a provider such as ECB for one bank's official "
    "fixing. Reference rates, not tradable quotes. For a single conversion use frankfurter/convert; for a series "
    "use frankfurter/history; for rates cross-checked across several banks with an agreement verdict use hako/fx.",
    categories=(Category.finance,),
    render=Render.fx,
    price=LOCAL,
    example={"base": "USD", "quotes": ["EUR", "JPY", "GBP"]},
    see_also=("frankfurter/convert", "frankfurter/history", "hako/fx"),
    cache_ttl_s=TTL_PAGE_S,  # central banks publish once a business day
)
async def rates(inp: RatesInput, ctx: RunContext) -> RatesOutput:
    quotes = list(dict.fromkeys(inp.quotes))
    params: dict[str, Any] = {"base": inp.base, "quotes": ",".join(quotes)}
    if inp.date:
        params["date"] = inp.date.isoformat()
    scope = _scope(params, inp.provider)
    rows = [r for r in await _rows(ctx, "/v2/rates", params) or [] if isinstance(r, dict) and "rate" in r]
    if not rows:
        raise ToolNotFoundResult(f"No {scope} rate is published from {inp.base} to {', '.join(quotes)}")
    missing = sorted(set(quotes) - {r["quote"] for r in rows})
    if missing:
        ctx.note(f"No {scope} rate for {', '.join(missing)}.")
    return RatesOutput(base=inp.base, provider=scope, rates=[_rate(r) for r in rows])


class ConvertInput(ToolInput):
    amount: float = Field(gt=0, description="How much of the source currency.")
    base: CurrencyCode = Field(description="Convert from this currency.")
    quote: CurrencyCode = Field(description="Convert to this currency.")
    date: dt.date | None = Field(None, description="Use the rate of this day (default: latest).")
    provider: str | None = ProviderKey


class ConvertOutput(ToolOutput):
    amount: float
    base: str
    quote: str
    rate: float
    converted: float
    date: str
    provider: str


@tool(
    provider=FRANKFURTER,
    slug="convert",
    name="Frankfurter Currency Converter",
    summary="Convert an amount between two currencies at the latest (or a dated) central-bank rate.",
    description="Converts an amount from one currency to another with the rate's publication date, at "
    "Frankfurter's blended central-bank rate or one bank's fixing (provider, e.g. ECB). Reference rates: a bank "
    "or card will charge a spread on top. For several target currencies use frankfurter/rates; to check "
    "the rate against several independent banks use hako/fx.",
    categories=(Category.finance,),
    render=Render.fx,
    price=LOCAL,
    example={"amount": 250, "base": "GBP", "quote": "NGN"},
    see_also=("frankfurter/rates", "hako/fx"),
    cache_ttl_s=TTL_PAGE_S,
)
async def convert(inp: ConvertInput, ctx: RunContext) -> ConvertOutput:
    params: dict[str, Any] = {}
    if inp.date:
        params["date"] = inp.date.isoformat()
    scope = _scope(params, inp.provider)
    missing = f"No {scope} rate is published from {inp.base} to {inp.quote}"
    try:
        row = await _rows(ctx, f"/v2/rate/{inp.base}/{inp.quote}", params)
    except ToolNotFoundResult as nf:
        raise ToolNotFoundResult(missing) from nf
    if not isinstance(row, dict) or "rate" not in row:
        raise ToolNotFoundResult(missing)
    rate = float(row["rate"])
    return ConvertOutput(amount=inp.amount, base=inp.base, quote=inp.quote, rate=rate,
                         converted=round(inp.amount * rate, CONVERTED_DECIMALS), date=row["date"], provider=scope)


class Group(StrEnum):
    day = "day"
    week = "week"
    month = "month"


class HistoryInput(ToolInput):
    base: CurrencyCode = "EUR"
    quotes: list[CurrencyCode] = Field(min_length=1, max_length=HISTORY_MAX_QUOTES)
    start: dt.date = Field(description="First day, YYYY-MM-DD.")
    end: dt.date | None = Field(None, description=f"Last day (default: today; at most {HISTORY_MAX_DAYS} days).")
    group: Group = Field(Group.day, description="One point per day, week or month.")
    provider: str | None = ProviderKey

    @model_validator(mode="after")
    def _span(self) -> "HistoryInput":
        end = self.end or dt.datetime.now(dt.UTC).date()
        if end < self.start:
            raise ValueError("end is before start")
        if (end - self.start).days > HISTORY_MAX_DAYS:
            raise ValueError(f"the range may span at most {HISTORY_MAX_DAYS} days")
        return self


class Point(ToolOutput):
    date: str
    quote: str
    rate: float


class SeriesSummary(ToolOutput):
    quote: str
    first: float
    last: float
    change_pct: float
    low: float
    high: float
    points: int


class HistoryOutput(ToolOutput):
    base: str
    provider: str
    start: str
    end: str
    summary: list[SeriesSummary]
    rows: list[Point]


def _summary(quote: str, points: list[Point]) -> SeriesSummary:
    values = [p.rate for p in points]
    change = (values[-1] - values[0]) / values[0] * PERCENT if values[0] else 0.0
    return SeriesSummary(quote=quote, first=values[0], last=values[-1], change_pct=round(change, CHANGE_DECIMALS),
                         low=min(values), high=max(values), points=len(values))


@tool(
    provider=FRANKFURTER,
    slug="history",
    name="Frankfurter Rate History",
    summary=f"Daily, weekly or monthly exchange-rate history for up to {HISTORY_MAX_DAYS} days, with change and range.",
    description=f"A rate series from one currency to up to {HISTORY_MAX_QUOTES} others between two dates (at "
    f"most {HISTORY_MAX_DAYS} days apart), one point per day, week or month, plus a per-currency summary: first "
    "and last value, % change, low and high. The default blend includes weekend points from banks that publish "
    "then; provider=ECB gives business days only. For today's rate use frankfurter/rates.",
    categories=(Category.finance,),
    render=Render.table,
    price=LOCAL,
    example={"base": "USD", "quotes": ["EUR"], "start": "2026-07-01", "end": "2026-09-28", "group": "week"},
    see_also=("frankfurter/rates", "hako/fx"),
    cache_ttl_s=TTL_REFERENCE_S,
)
async def history(inp: HistoryInput, ctx: RunContext) -> HistoryOutput:
    end = inp.end or dt.datetime.now(dt.UTC).date()
    quotes = list(dict.fromkeys(inp.quotes))
    params: dict[str, Any] = {"base": inp.base, "quotes": ",".join(quotes), "from": inp.start.isoformat(),
                              "to": end.isoformat()}
    if inp.group is not Group.day:
        params["group"] = inp.group.value
    scope = _scope(params, inp.provider)
    raw = await _rows(ctx, "/v2/rates", params) or []
    points = sorted((Point(date=r["date"], quote=r["quote"], rate=r["rate"]) for r in raw
                     if isinstance(r, dict) and "rate" in r), key=lambda p: (p.quote, p.date))
    if not points:
        raise ToolNotFoundResult(f"No {scope} rates from {inp.base} to {', '.join(quotes)} in that range")
    by_quote: dict[str, list[Point]] = {}
    for p in points:
        by_quote.setdefault(p.quote, []).append(p)
    return HistoryOutput(base=inp.base, provider=scope, start=inp.start.isoformat(), end=end.isoformat(),
                         summary=[_summary(q, ps) for q, ps in by_quote.items()],
                         rows=sorted(points, key=lambda p: (p.date, p.quote)))
