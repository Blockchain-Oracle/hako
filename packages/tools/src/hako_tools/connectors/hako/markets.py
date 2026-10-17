"""hako/fx: exchange rates read from several central banks and other independent publishers, compared."""

from pydantic import Field

from hako_now.constants import FX_MAX_PROVIDERS, FX_MAX_QUOTES
from hako_now.fx.models import FxRequest, FxResult
from hako_now.fx.service import get_fx
from hako_tools.connectors.hako.bridge import call_now, report
from hako_tools.connectors.hako.provider import HAKO
from hako_tools.constants import TTL_LIVE_S
from hako_tools.framework import STANDARD, Category, ProviderError, Render, RunContext, ToolInput, ToolOutput, tool


class FxInput(ToolInput, FxRequest):
    """A base currency and up to ten quotes; optionally an amount to convert and a past date."""


class FxOutput(ToolOutput):
    base: str
    rates: list[FxResult]
    unavailable: list[str] = Field(default_factory=list)


@tool(
    provider=HAKO,
    slug="fx",
    name="Hako Cross-checked FX",
    summary="Exchange rates checked across up to four central banks: headline rate, each bank's fixing and date, "
    "spread and agreement.",
    description=f"For one base currency and up to {FX_MAX_QUOTES} quotes, reads the fixings of up to "
    f"{FX_MAX_PROVIDERS} independent publishers per pair (the quote currency's own central bank first, then the "
    "ECB, the Fed and others, via Frankfurter, with the ECB's own file as fallback), and returns the headline rate "
    "(the issuer's fixing when current, else the median), every bank's rate with its date, type and age on its "
    "own publishing schedule, the spread between them and an agree / minor_diff / conflict verdict. Pass amount "
    "to convert, date for a past day. Reference rates, not tradable quotes. For a quick single-source rate use "
    "frankfurter/rates or frankfurter/convert.",
    categories=(Category.finance,),
    render=Render.fx,
    price=STANDARD,  # fans out to several publishers per pair
    example={"base": "USD", "quotes": ["EUR", "JPY", "NGN"], "amount": 1000},
    see_also=("frankfurter/rates", "frankfurter/convert", "frankfurter/history"),
    cache_ttl_s=TTL_LIVE_S,
)
async def fx(inp: FxInput, ctx: RunContext) -> FxOutput:
    results, sources, unavailable = await call_now(get_fx(inp))
    missing = report(ctx, sources, unavailable)
    if not results:
        raise ProviderError("No FX publisher answered for this pair right now; retry shortly")
    absent = sorted(set(inp.quotes) - {r.quote for r in results})
    if absent:
        ctx.note(f"No current fixing found for {', '.join(absent)}.")
    return FxOutput(base=inp.base, rates=results, unavailable=missing)
